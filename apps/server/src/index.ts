import { createServerApp, createServerContainer } from "./server.js";

interface ProcessLike {
  env?: Record<string, string | undefined>;
  pid?: number;
  exitCode?: number;
  on?: (eventName: string, listener: () => void) => void;
}

const processLike = (globalThis as { process?: ProcessLike }).process;

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
  container: createServerContainer(),
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
    await server.stop();
  } catch (error) {
    console.error("Failed to stop local server cleanly", error);
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
  const handshake = await server.start();

  console.log(
    JSON.stringify({
      type: "server-handshake",
      pid: processLike?.pid ?? null,
      ...handshake
    })
  );
} catch (error) {
  console.error("Failed to start local server", error);
  if (processLike) {
    processLike.exitCode = 1;
  }
  throw error;
}
