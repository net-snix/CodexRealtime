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
  entryOverride?: string;
  spawnProcess?: typeof spawn;
  pathExists?: (path: string) => boolean;
  mainDirectory?: string;
  expectedVersion?: string;
  onUnexpectedExit?: (event: LocalServerUnexpectedExit) => void;
}

type Logger = Pick<Console, "info" | "error">;
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
const HANDSHAKE_PREFIX = "{\"type\":\"server-handshake\"";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

export const parseServerHandshakeLine = (line: string): LocalServerHandshake | null => {
  const trimmed = line.trim();

  if (!trimmed.startsWith(HANDSHAKE_PREFIX)) {
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
  private readonly entryOverride: string | undefined;
  private readonly spawnProcess: typeof spawn;
  private readonly pathExists: (path: string) => boolean;
  private readonly mainDirectory: string | undefined;
  private readonly expectedVersion: string | undefined;
  private readonly onUnexpectedExit: ((event: LocalServerUnexpectedExit) => void) | undefined;
  private readonly logger: Logger;
  private isStopping = false;

  constructor(options: LocalServerProcessOptions = {}, logger: Logger = console) {
    this.host = options.host ?? DEFAULT_HOST;
    this.port = options.port ?? DEFAULT_PORT;
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.entryOverride = options.entryOverride;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.pathExists = options.pathExists ?? existsSync;
    this.mainDirectory = options.mainDirectory;
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
        CODEX_REALTIME_SERVER_HOST: this.host,
        CODEX_REALTIME_SERVER_PORT: String(this.port)
      }
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
      let stderrBuffer = "";
      let settled = false;
      let timeoutId: NodeJS.Timeout;

      const handleStdoutData = (chunk: Buffer | string) => {
        stdoutBuffer += chunk.toString();

        while (stdoutBuffer.includes("\n")) {
          const newlineIndex = stdoutBuffer.indexOf("\n");
          const line = stdoutBuffer.slice(0, newlineIndex);
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

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
        stderrBuffer += message;
        this.logger.error("Local server stderr", { message });
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
              `Local server exited before handshake (code=${code ?? "null"}, signal=${signal ?? "null"})${stderrBuffer ? `: ${stderrBuffer.trim()}` : ""}`
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

      timeoutId = setTimeout(() => {
        settle(() => {
          child.kill("SIGKILL");
          rejectHandshake(
            new Error(
              `Timed out waiting for local server handshake from ${entryPath}${stderrBuffer ? ` (${stderrBuffer.trim()})` : ""}`
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
