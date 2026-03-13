import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStructuredLogRecord, createStructuredLogger } from "./structured-log";

const tempDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();

  while (tempDirectories.length > 0) {
    const nextDirectory = tempDirectories.pop();
    if (nextDirectory) {
      rmSync(nextDirectory, { recursive: true, force: true });
    }
  }
});

describe("createStructuredLogRecord", () => {
  it("keeps correlation, thread, and session identifiers separate from data", () => {
    const record = createStructuredLogRecord({
      source: "desktop",
      scope: "bootstrap",
      level: "info",
      message: "Desktop bootstrap started",
      clock: () => new Date("2026-03-12T10:00:00.000Z"),
      baseContext: {
        correlationId: "boot-1"
      },
      context: {
        threadId: "thread-1",
        sessionId: "session-1",
        healthUrl: "http://127.0.0.1:43123/health"
      }
    });

    expect(record).toEqual({
      timestamp: "2026-03-12T10:00:00.000Z",
      source: "desktop",
      scope: "bootstrap",
      level: "info",
      message: "Desktop bootstrap started",
      correlationId: "boot-1",
      threadId: "thread-1",
      sessionId: "session-1",
      data: {
        healthUrl: "http://127.0.0.1:43123/health"
      }
    });
  });

  it("serializes errors into queryable data fields", () => {
    const error = new Error("socket closed");
    error.name = "BootstrapError";

    const record = createStructuredLogRecord({
      source: "server",
      scope: "bootstrap",
      level: "error",
      message: "Server bootstrap failed",
      context: {
        error,
        attempt: 2
      }
    });

    expect(record.data).toEqual({
      error: expect.objectContaining({
        name: "BootstrapError",
        message: "socket closed"
      }),
      attempt: 2
    });
  });

  it("truncates deeply nested context values to avoid unbounded recursion", () => {
    let nested: Record<string, unknown> = {};
    const root = nested;

    for (let index = 0; index < 12; index += 1) {
      const next: Record<string, unknown> = {};
      nested.child = next;
      nested = next;
    }

    const record = createStructuredLogRecord({
      source: "desktop",
      scope: "bootstrap",
      level: "info",
      message: "Deep context payload",
      context: {
        nested: root
      }
    });

    let cursor: unknown = (record.data as { nested?: unknown })?.nested;
    let depthLimitHit = false;

    for (let index = 0; index < 12; index += 1) {
      if (cursor === "[DepthLimitExceeded]") {
        depthLimitHit = true;
        break;
      }

      if (!cursor || typeof cursor !== "object") {
        break;
      }

      cursor = (cursor as { child?: unknown }).child;
    }

    expect(depthLimitHit).toBe(true);
  });

  it("redacts secret-like keys and caps oversized nested payloads", () => {
    const record = createStructuredLogRecord({
      source: "server",
      scope: "bootstrap",
      level: "info",
      message: "Payload received",
      context: {
        accessToken: "top-secret",
        nested: {
          clientSecret: "also-secret",
          values: Array.from({ length: 26 }, (_, index) => index + 1),
          fields: Object.fromEntries(
            Array.from({ length: 26 }, (_, index) => [`field${index + 1}`, index + 1])
          )
        }
      }
    });

    expect(record.data).toEqual({
      accessToken: "[Redacted]",
      nested: {
        clientSecret: "[Redacted]",
        values: [...Array.from({ length: 24 }, (_, index) => index + 1), "[+2 items]"],
        fields: {
          ...Object.fromEntries(
            Array.from({ length: 24 }, (_, index) => [`field${index + 1}`, index + 1])
          ),
          __truncatedKeys: 2
        }
      }
    });
  });
});

describe("createStructuredLogger", () => {
  it("writes NDJSON records that are queryable on disk", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-realtime-log-"));
    tempDirectories.push(directory);
    const logFilePath = join(directory, "desktop.ndjson");
    const writeLine = vi.fn();
    const logger = createStructuredLogger({
      source: "desktop",
      scope: "bootstrap",
      logFilePath,
      baseContext: {
        correlationId: "boot-1"
      },
      writeLine
    });

    logger.info("Local server ready", {
      threadId: "thread-1",
      sessionId: "session-1",
      baseUrl: "http://127.0.0.1:43123"
    });

    expect(writeLine).toHaveBeenCalledTimes(1);

    const [firstLine] = readFileSync(logFilePath, "utf8").trim().split("\n");
    expect(JSON.parse(firstLine)).toEqual(
      expect.objectContaining({
        source: "desktop",
        scope: "bootstrap",
        correlationId: "boot-1",
        threadId: "thread-1",
        sessionId: "session-1",
        data: {
          baseUrl: "http://127.0.0.1:43123"
        }
      })
    );
  });

  it("writes serialized errors to NDJSON sinks", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-realtime-log-"));
    tempDirectories.push(directory);
    const logFilePath = join(directory, "server.ndjson");
    const logger = createStructuredLogger({
      source: "server",
      scope: "bootstrap",
      logFilePath,
      baseContext: {
        correlationId: "boot-2"
      },
      writeLine: vi.fn()
    });

    logger.error("Server bootstrap failed", {
      error: new Error("socket closed")
    });

    const [firstLine] = readFileSync(logFilePath, "utf8").trim().split("\n");
    expect(JSON.parse(firstLine)).toEqual(
      expect.objectContaining({
        correlationId: "boot-2",
        data: {
          error: expect.objectContaining({
            name: "Error",
            message: "socket closed"
          })
        }
      })
    );
  });
});
