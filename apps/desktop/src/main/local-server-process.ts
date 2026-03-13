import { spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";

export interface LocalServerHandshake {
  type: "server-handshake";
  pid: number | null;
  protocol: string;
  name: string;
  version: string;
  ready: boolean;
  startedAt: string | null;
  baseUrl: string | null;
  healthUrl: string | null;
  sessionCount: number;
}

export interface LocalServerProcessOptions {
  host?: string;
  port?: number;
  startupTimeoutMs?: number;
  maxHandshakeStdoutBytes?: number;
  maxHandshakeStderrBytes?: number;
  entryOverride?: string;
  spawnProcess?: typeof spawn;
  pathExists?: (path: string) => boolean;
  mainDirectory?: string;
  bootstrapId?: string;
  serverLogFilePath?: string;
  expectedVersion?: string;
  onUnexpectedExit?: (event: LocalServerUnexpectedExit) => void;
}

type Logger = {
  info(message: string, fields?: object): void;
  error(message: string, fields?: object): void;
};
type LocalServerChild = ChildProcessByStdio<null, Readable, Readable>;

export interface LocalServerUnexpectedExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  entryPath: string;
  handshake: LocalServerHandshake | null;
  expectedVersion: string | null;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 0;
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_HANDSHAKE_STDOUT_BYTES = 64 * 1024;
const DEFAULT_MAX_HANDSHAKE_STDERR_BYTES = 8 * 1024;
const HANDSHAKE_PREFIX = "{\"type\":\"server-handshake\"";
const MAX_HANDSHAKE_LINE_LENGTH = 8 * 1024;
const OVERSIZED_HANDSHAKE_STDOUT_ERROR =
  "Local server sent oversized startup stdout before handshake";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";
const utf8ByteLength = (value: string) => Buffer.byteLength(value, "utf8");

const retainUtf8Tail = (value: string, maxBytes: number) => {
  if (!value || maxBytes <= 0) {
    return "";
  }

  let retainedBytes = 0;
  let retainedStartIndex = value.length;

  for (const codePoint of Array.from(value).reverse()) {
    const codePointBytes = utf8ByteLength(codePoint);

    if (retainedBytes + codePointBytes > maxBytes) {
      break;
    }

    retainedBytes += codePointBytes;
    retainedStartIndex -= codePoint.length;
  }

  return value.slice(retainedStartIndex);
};

const formatBufferedStderr = (stderrBuffer: string, truncated: boolean) => {
  const trimmed = stderrBuffer.trim();

  if (!trimmed) {
    return "";
  }

  return truncated ? ` (stderr tail: ${trimmed})` : ` (${trimmed})`;
};

export const parseServerHandshakeLine = (line: string): LocalServerHandshake | null => {
  const trimmed = line.trim();

  if (!trimmed.startsWith(HANDSHAKE_PREFIX) || trimmed.length > MAX_HANDSHAKE_LINE_LENGTH) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;

    if (
      !isRecord(parsed) ||
      parsed.type !== "server-handshake" ||
      typeof parsed.protocol !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.version !== "string" ||
      typeof parsed.ready !== "boolean"
    ) {
      return null;
    }

    return {
      type: "server-handshake",
      pid: typeof parsed.pid === "number" ? parsed.pid : null,
      protocol: parsed.protocol,
      name: parsed.name,
      version: parsed.version,
      ready: parsed.ready,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : null,
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : null,
      healthUrl: typeof parsed.healthUrl === "string" ? parsed.healthUrl : null,
      sessionCount: typeof parsed.sessionCount === "number" ? parsed.sessionCount : 0
    };
  } catch {
    return null;
  }
};

export const resolveLocalServerEntry = (options: {
  entryOverride?: string;
  mainDirectory?: string;
  pathExists?: (path: string) => boolean;
}) => {
  const pathExists = options.pathExists ?? existsSync;

  if (options.entryOverride) {
    return resolve(options.entryOverride);
  }

  const mainDirectory = options.mainDirectory ?? __dirname;
  const candidates = [
    join(mainDirectory, "../local-server/index.js"),
    join(mainDirectory, "../../../../apps/server/dist/index.js")
  ];

  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (pathExists(resolved)) {
      return resolved;
    }
  }

  throw new Error(
    `Local server entry not found. Expected one of: ${candidates.map((candidate) => resolve(candidate)).join(", ")}`
  );
};

export const validateLocalServerHandshake = (
  handshake: LocalServerHandshake,
  expectedVersion?: string | null
) => {
  if (expectedVersion && handshake.version !== expectedVersion) {
    throw new Error(
      `Local server version mismatch. Shell=${expectedVersion}, server=${handshake.version}. Rebuild desktop and server together.`
    );
  }

  return handshake;
};

export class LocalServerProcess {
  private child: LocalServerChild | null = null;
  private handshake: LocalServerHandshake | null = null;
  private readonly host: string;
  private readonly port: number;
  private readonly startupTimeoutMs: number;
  private readonly maxHandshakeStdoutBytes: number;
  private readonly maxHandshakeStderrBytes: number;
  private readonly entryOverride: string | undefined;
  private readonly spawnProcess: typeof spawn;
  private readonly pathExists: (path: string) => boolean;
  private readonly mainDirectory: string | undefined;
  private readonly bootstrapId: string | undefined;
  private readonly serverLogFilePath: string | undefined;
  private readonly expectedVersion: string | undefined;
  private readonly onUnexpectedExit: ((event: LocalServerUnexpectedExit) => void) | undefined;
  private readonly logger: Logger;
  private isStopping = false;

  constructor(options: LocalServerProcessOptions = {}, logger: Logger = console) {
    this.host = options.host ?? DEFAULT_HOST;
    this.port = options.port ?? DEFAULT_PORT;
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.maxHandshakeStdoutBytes = Math.max(
      1,
      options.maxHandshakeStdoutBytes ?? DEFAULT_MAX_HANDSHAKE_STDOUT_BYTES
    );
    this.maxHandshakeStderrBytes = Math.max(
      1,
      options.maxHandshakeStderrBytes ?? DEFAULT_MAX_HANDSHAKE_STDERR_BYTES
    );
    this.entryOverride = options.entryOverride;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.pathExists = options.pathExists ?? existsSync;
    this.mainDirectory = options.mainDirectory;
    this.bootstrapId = options.bootstrapId;
    this.serverLogFilePath = options.serverLogFilePath;
    this.expectedVersion = options.expectedVersion;
    this.onUnexpectedExit = options.onUnexpectedExit;
    this.logger = logger;
  }

  getHandshake() {
    return this.handshake;
  }

  async start() {
    if (this.child && this.handshake) {
      return this.handshake;
    }

    const entryPath = resolveLocalServerEntry({
      entryOverride: this.entryOverride,
      mainDirectory: this.mainDirectory,
      pathExists: this.pathExists
    });

    const child = this.spawnProcess(process.execPath, [entryPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CODEX_REALTIME_BOOTSTRAP_ID: this.bootstrapId,
        CODEX_REALTIME_SERVER_LOG_PATH: this.serverLogFilePath,
        CODEX_REALTIME_SERVER_HOST: this.host,
        CODEX_REALTIME_SERVER_PORT: String(this.port)
      }
    });

    this.logger.info("Starting local server process", {
      entryPath,
      host: this.host,
      requestedPort: this.port,
      expectedVersion: this.expectedVersion ?? null
    });
    this.child = child;
    this.isStopping = false;
    this.attachUnexpectedExitHandler(child, entryPath);

    let handshake: LocalServerHandshake;

    try {
      handshake = validateLocalServerHandshake(
        await this.waitForHandshake(child, entryPath),
        this.expectedVersion
      );
    } catch (error) {
      await this.stop();
      throw error;
    }

    this.handshake = handshake;
    this.logger.info("Local server process ready", {
      pid: child.pid ?? null,
      entryPath,
      baseUrl: handshake.baseUrl,
      healthUrl: handshake.healthUrl
    });
    return handshake;
  }

  async stop() {
    const child = this.child;
    this.isStopping = true;

    this.child = null;
    this.handshake = null;

    if (!child || child.exitCode !== null) {
      this.isStopping = false;
      return;
    }

    this.logger.info("Stopping local server process", {
      pid: child.pid ?? null
    });

    await new Promise<void>((resolveStop) => {
      const timeoutId = setTimeout(() => {
        child.kill("SIGKILL");
      }, 2_000);

      child.once("exit", () => {
        clearTimeout(timeoutId);
        resolveStop();
      });

      child.kill("SIGTERM");
    });

    this.isStopping = false;
  }

  private attachUnexpectedExitHandler(child: LocalServerChild, entryPath: string) {
    child.on("exit", (code, signal) => {
      if (this.child !== child) {
        return;
      }

      const handshake = this.handshake;
      this.child = null;
      this.handshake = null;

      if (this.isStopping || !handshake) {
        return;
      }

      const event: LocalServerUnexpectedExit = {
        code: code ?? null,
        signal: signal ?? null,
        entryPath,
        handshake,
        expectedVersion: this.expectedVersion ?? null
      };

      this.logger.error("Local server exited unexpectedly", event);
      this.onUnexpectedExit?.(event);
    });
  }

  private waitForHandshake(child: LocalServerChild, entryPath: string) {
    return new Promise<LocalServerHandshake>((resolveHandshake, rejectHandshake) => {
      let stdoutBuffer = "";
      let stdoutBufferBytes = 0;
      let stderrBuffer = "";
      let stderrBufferTruncated = false;
      let settled = false;

      const handleStdoutData = (chunk: Buffer | string) => {
        const message = chunk.toString();
        const messageByteLength = utf8ByteLength(message);

        if (stdoutBufferBytes + messageByteLength > this.maxHandshakeStdoutBytes) {
          settle(() => {
            child.kill("SIGKILL");
            rejectHandshake(
              new Error(
                `${OVERSIZED_HANDSHAKE_STDOUT_ERROR} from ${entryPath} (${this.maxHandshakeStdoutBytes} bytes max)${formatBufferedStderr(
                  stderrBuffer,
                  stderrBufferTruncated
                )}`
              )
            );
          });
          return;
        }

        stdoutBuffer += message;
        stdoutBufferBytes += messageByteLength;

        while (stdoutBuffer.includes("\n")) {
          const newlineIndex = stdoutBuffer.indexOf("\n");
          const consumed = stdoutBuffer.slice(0, newlineIndex + 1);
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
          stdoutBufferBytes -= utf8ByteLength(consumed);
          const line = consumed.slice(0, -1);

          const handshake = parseServerHandshakeLine(line);
          if (!handshake) {
            continue;
          }

          settle(() => resolveHandshake(handshake));
          return;
        }
      };

      const handleStderrData = (chunk: Buffer | string) => {
        const message = chunk.toString();
        const combined = `${stderrBuffer}${message}`;

        if (utf8ByteLength(combined) > this.maxHandshakeStderrBytes) {
          stderrBuffer = retainUtf8Tail(combined, this.maxHandshakeStderrBytes);
          stderrBufferTruncated = true;
        } else {
          stderrBuffer = combined;
        }
        process.stderr.write(message);
      };

      const handleError = (error: Error) => {
        settle(() =>
          rejectHandshake(new Error(`Failed to spawn local server process: ${error.message}`))
        );
      };

      const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
        settle(() =>
          rejectHandshake(
            new Error(
              `Local server exited before handshake (code=${code ?? "null"}, signal=${signal ?? "null"})${formatBufferedStderr(
                stderrBuffer,
                stderrBufferTruncated
              )}`
            )
          )
        );
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        child.stdout.off("data", handleStdoutData);
        child.stderr.off("data", handleStderrData);
        child.off("error", handleError);
        child.off("exit", handleExit);
      };

      const settle = (callback: () => void) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        callback();
      };

      const timeoutId = setTimeout(() => {
        settle(() => {
          child.kill("SIGKILL");
          rejectHandshake(
            new Error(
              `Timed out waiting for local server handshake from ${entryPath}${formatBufferedStderr(
                stderrBuffer,
                stderrBufferTruncated
              )}`
            )
          );
        });
      }, this.startupTimeoutMs);

      child.stdout.on("data", handleStdoutData);
      child.stderr.on("data", handleStderrData);
      child.once("error", handleError);
      child.once("exit", handleExit);
    });
  }
}

export const localServerProcess = new LocalServerProcess();
