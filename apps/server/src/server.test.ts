import { createServerApp, createServerContainer } from "./server.js";

const processLike = (globalThis as { process?: { exitCode?: number } }).process;

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertEqual = (actual: unknown, expected: unknown, message?: string) => {
  if (!Object.is(actual, expected)) {
    throw new Error(message ?? `Expected ${String(expected)}, received ${String(actual)}`);
  }
};

const tests: Array<{
  name: string;
  run: () => Promise<void> | void;
}> = [];

const test = (name: string, run: () => Promise<void> | void) => {
  tests.push({ name, run });
};

const silentLogger = {
  info: (_message: string, _fields?: Record<string, unknown>) => {},
  error: (_message: string, _fields?: Record<string, unknown>) => {}
};

test("serves a ready health payload after startup", async () => {
  const app = createServerApp({
    container: createServerContainer({
      appVersion: "test-build",
      logger: silentLogger
    })
  });

  const beforeStart = app.createHandshake();
  assertEqual(beforeStart.ready, false);
  assertEqual(beforeStart.healthUrl, null);

  const handshake = await app.start();

  assertEqual(handshake.protocol, "codex-realtime.local-server.v1");
  assertEqual(handshake.name, "@codex-realtime/server");
  assertEqual(handshake.version, "test-build");
  assertEqual(handshake.ready, true);
  assert(typeof handshake.baseUrl === "string", "Expected a base URL after startup");
  assert(handshake.healthUrl !== null, "Expected a health URL after startup");

  const response = await fetch(handshake.healthUrl);
  assertEqual(response.status, 200);

  const body = (await response.json()) as Record<string, unknown>;
  assertEqual(body.ready, true);
  assertEqual(body.protocol, "codex-realtime.local-server.v1");
  assertEqual(body.version, "test-build");
  assertEqual(body.baseUrl, handshake.baseUrl);

  const readyResponse = await fetch(`${handshake.baseUrl}/ready`);
  assertEqual(readyResponse.status, 200);

  await app.stop();
  const stoppedHandshake = app.createHandshake();
  assertEqual(stoppedHandshake.ready, false);
  assertEqual(stoppedHandshake.baseUrl, null);
  assertEqual(stoppedHandshake.healthUrl, null);
});

test("reuses injected container state in the readiness handshake", async () => {
  const container = createServerContainer({
    appVersion: "2.0.0-test",
    clock: () => new Date("2026-03-12T00:00:00.000Z"),
    logger: silentLogger
  });

  container.sessionStore.set("session-1", { id: "session-1" });

  const app = createServerApp({ container });
  const handshake = await app.start();

  assertEqual(handshake.startedAt, "2026-03-12T00:00:00.000Z");
  assertEqual(handshake.sessionCount, 1);

  await app.stop();
});

const run = async () => {
  const failures: string[] = [];

  for (const entry of tests) {
    try {
      await entry.run();
      console.log(`ok - ${entry.name}`);
    } catch (error) {
      failures.push(entry.name);
      console.error(`not ok - ${entry.name}`);
      console.error(error);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Server tests failed: ${failures.join(", ")}`);
  }
};

void run().catch((error: unknown) => {
  console.error(error);
  if (processLike) {
    processLike.exitCode = 1;
  }
});
