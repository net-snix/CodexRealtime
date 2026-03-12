import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBootstrapLogRecord, createBootstrapLogger } from "./bootstrap-logger";

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

describe("createBootstrapLogRecord", () => {
  it("emits correlation id separately from structured fields", () => {
    const record = createBootstrapLogRecord({
      scope: "bootstrap",
      level: "info",
      message: "Desktop bootstrap starting",
      clock: () => new Date("2026-03-12T12:00:00.000Z"),
      bootstrapId: "boot-123",
      appVersion: "0.1.0",
      userDataPath: "/tmp/codex",
      context: {
        sessionId: "session-1"
      }
    });

    expect(record).toEqual({
      timestamp: "2026-03-12T12:00:00.000Z",
      source: "desktop",
      scope: "bootstrap",
      level: "info",
      message: "Desktop bootstrap starting",
      correlationId: "boot-123",
      threadId: null,
      sessionId: "session-1",
      data: {
        appVersion: "0.1.0",
        userDataPath: "/tmp/codex"
      }
    });
  });
});

describe("createBootstrapLogger", () => {
  it("writes ndjson lines and keeps child scopes on the same correlation id", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-realtime-desktop-log-"));
    tempDirectories.push(directory);
    const writeLine = vi.fn();
    const bundle = createBootstrapLogger({
      bootstrapId: "boot-456",
      appVersion: "0.1.0",
      userDataPath: directory,
      writeLine
    });

    bundle.localServerLogger.info("Local server process ready", {
      threadId: "thread-1",
      baseUrl: "http://127.0.0.1:43123"
    });

    expect(writeLine).toHaveBeenCalledTimes(1);

    const [firstLine] = readFileSync(bundle.paths.desktopLogPath, "utf8").trim().split("\n");
    expect(JSON.parse(firstLine)).toEqual({
      timestamp: expect.any(String),
      source: "desktop",
      scope: "local-server",
      level: "info",
      message: "Local server process ready",
      correlationId: "boot-456",
      threadId: "thread-1",
      sessionId: null,
      data: {
        appVersion: "0.1.0",
        userDataPath: directory,
        baseUrl: "http://127.0.0.1:43123"
      }
    });
  });
});
