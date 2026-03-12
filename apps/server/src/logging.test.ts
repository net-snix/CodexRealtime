import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStructuredLogger, createStructuredLogRecord } from "./logging.js";

const processLike = (globalThis as { process?: { exitCode?: number } }).process;
const tempDirectories: string[] = [];

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

test("separates identifiers from structured fields", () => {
  const record = createStructuredLogRecord({
    scope: "bootstrap",
    level: "info",
    message: "Local server bootstrap starting",
    clock: () => new Date("2026-03-12T12:00:00.000Z"),
    bootstrapId: "boot-123",
    baseFields: {
      pid: 321
    },
    fields: {
      threadId: "thread-1",
      sessionId: "session-1",
      host: "127.0.0.1"
    }
  });

  assertEqual(record.timestamp, "2026-03-12T12:00:00.000Z");
  assertEqual(record.source, "server");
  assertEqual(record.scope, "bootstrap");
  assertEqual(record.level, "info");
  assertEqual(record.message, "Local server bootstrap starting");
  assertEqual(record.correlationId, "boot-123");
  assertEqual(record.threadId, "thread-1");
  assertEqual(record.sessionId, "session-1");
  assert(
    JSON.stringify(record.data) === JSON.stringify({ pid: 321, host: "127.0.0.1" }),
    "Expected structured fields to keep non-identifier values"
  );
});

test("writes one ndjson log line with correlation id", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-realtime-server-log-"));
  tempDirectories.push(directory);
  const logFilePath = join(directory, "server-bootstrap.ndjson");
  const sinkLines: string[] = [];
  const logger = createStructuredLogger("lifecycle", {
    bootstrapId: "boot-456",
    logFilePath,
    writeLine: (line: string) => {
      sinkLines.push(line);
    }
  });

  logger.info("Local server ready", {
    host: "127.0.0.1",
    baseUrl: "http://127.0.0.1:43123"
  });

  assertEqual(sinkLines.length, 1);
  const fileLines = readFileSync(logFilePath, "utf8").trim().split("\n");
  assertEqual(fileLines.length, 1);

  const parsed = JSON.parse(fileLines[0]) as Record<string, unknown>;
  assertEqual(parsed.source, "server");
  assertEqual(parsed.scope, "lifecycle");
  assertEqual(parsed.correlationId, "boot-456");
  assertEqual(parsed.message, "Local server ready");
  assert(
    JSON.stringify(parsed.data) ===
      JSON.stringify({
        host: "127.0.0.1",
        baseUrl: "http://127.0.0.1:43123"
      }),
    "Expected written NDJSON line to preserve structured fields"
  );
});

const run = async () => {
  const failures: string[] = [];

  try {
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
  } finally {
    while (tempDirectories.length > 0) {
      const nextDirectory = tempDirectories.pop();
      if (nextDirectory) {
        rmSync(nextDirectory, { recursive: true, force: true });
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`Logging tests failed: ${failures.join(", ")}`);
  }
};

void run().catch((error: unknown) => {
  console.error(error);
  if (processLike) {
    processLike.exitCode = 1;
  }
});
