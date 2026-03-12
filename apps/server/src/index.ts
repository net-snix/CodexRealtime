import { createStructuredLogger } from "./logging.js";
import { createServerApp, createServerContainer } from "./server.js";

interface ProcessLike {
  env?: Record<string, string | undefined>;
  pid?: number;
  exitCode?: number;
  stderr?: {
    write(chunk: string): void;
  };
  on?: (eventName: string, listener: () => void) => void;
}

const processLike = (globalThis as { process?: ProcessLike }).process;
const bootstrapId = processLike?.env?.CODEX_REALTIME_BOOTSTRAP_ID ?? null;
const logFilePath = processLike?.env?.CODEX_REALTIME_SERVER_LOG_PATH ?? null;
const appVersion = "0.1.0";
const serverLogger = createStructuredLogger("bootstrap", {
  bootstrapId,
  logFilePath,
  baseFields: {
    pid: processLike?.pid ?? null,
    appVersion
  },
  writeLine: (line: string) => {
    processLike?.stderr?.write(`${line}\n`);
  }
});

const parsePort = (rawPort: string | undefined) => {
  if (!rawPort) {
    return 0;
  }

  const parsedPort = Number.parseInt(rawPort, 10);
  if (!Number.isFinite(parsedPort) || parsedPort < 0) {
    throw new Error(`Invalid CODEX_REALTIME_SERVER_PORT: ${rawPort}`);
  }

  return parsedPort;
};

const server = createServerApp({
  container: createServerContainer({
    logger: createStructuredLogger("lifecycle", {
      bootstrapId,
      logFilePath,
      baseFields: {
        appVersion
      },
      writeLine: (line: string) => {
        processLike?.stderr?.write(`${line}\n`);
      }
    }),
    appVersion
  }),
  host: processLike?.env?.CODEX_REALTIME_SERVER_HOST ?? "127.0.0.1",
  port: parsePort(processLike?.env?.CODEX_REALTIME_SERVER_PORT)
});

let shuttingDown = false;

const shutdown = async () => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  try {
    serverLogger.info("Local server shutdown requested");
    await server.stop();
  } catch (error) {
    serverLogger.error("Failed to stop local server cleanly", { error });
    if (processLike) {
      processLike.exitCode = 1;
    }
  }
};

processLike?.on?.("SIGINT", () => {
  void shutdown();
});

processLike?.on?.("SIGTERM", () => {
  void shutdown();
});

try {
  serverLogger.info("Local server bootstrap starting", {
    host: processLike?.env?.CODEX_REALTIME_SERVER_HOST ?? "127.0.0.1",
    port: parsePort(processLike?.env?.CODEX_REALTIME_SERVER_PORT)
  });
  const handshake = await server.start();
  serverLogger.info("Local server handshake emitted", {
    baseUrl: handshake.baseUrl,
    healthUrl: handshake.healthUrl
  });

  console.log(
    JSON.stringify({
      type: "server-handshake",
      pid: processLike?.pid ?? null,
      ...handshake
    })
  );
} catch (error) {
  serverLogger.error("Failed to start local server", { error });
  if (processLike) {
    processLike.exitCode = 1;
  }
  throw error;
}
