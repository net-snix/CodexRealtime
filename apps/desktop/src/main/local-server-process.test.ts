import type { ChildProcessByStdio } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, type Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LocalServerProcess,
  parseServerHandshakeLine,
  resolveLocalServerEntry,
  validateLocalServerHandshake,
  type LocalServerHandshake,
  type LocalServerProcessOptions
} from "./local-server-process";

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  pid = 321;
  exitCode: number | null = null;
  readonly kill = vi.fn((signal?: NodeJS.Signals) => {
    this.exitCode = this.exitCode ?? 0;
    queueMicrotask(() => {
      this.emit("exit", this.exitCode, signal ?? null);
    });
    return true;
  });
}

const asChildProcess = (child: FakeChildProcess) =>
  child as unknown as ChildProcessByStdio<null, Readable, Readable>;

const createSpawnProcess = (child: FakeChildProcess) =>
  ((() => asChildProcess(child)) as unknown) as LocalServerProcessOptions["spawnProcess"];

const createSilentLogger = () => ({
  info: vi.fn(),
  error: vi.fn()
});

const createHandshake = (version = "0.1.0"): LocalServerHandshake => ({
  type: "server-handshake",
  pid: 123,
  protocol: "codex-realtime.local-server.v1",
  name: "@codex-realtime/server",
  version,
  ready: true,
  startedAt: "2026-03-12T10:00:00.000Z",
  baseUrl: "http://127.0.0.1:43123",
  healthUrl: "http://127.0.0.1:43123/health",
  sessionCount: 0
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("resolveLocalServerEntry", () => {
  it("prefers the explicit override path", () => {
    const entry = resolveLocalServerEntry({
      entryOverride: "/tmp/custom-server.js",
      pathExists: () => false
    });

    expect(entry).toBe("/tmp/custom-server.js");
  });

  it("falls back to the copied desktop build path before the repo dist path", () => {
    const existing = new Set([
      "/repo/apps/desktop/out/local-server/index.js",
      "/repo/apps/server/dist/index.js"
    ]);

    const entry = resolveLocalServerEntry({
      mainDirectory: "/repo/apps/desktop/out/main",
      pathExists: (path) => existing.has(path)
    });

    expect(entry).toBe("/repo/apps/desktop/out/local-server/index.js");
  });

  it("throws when neither canonical server entry exists", () => {
    expect(() =>
      resolveLocalServerEntry({
        mainDirectory: "/repo/apps/desktop/out/main",
        pathExists: () => false
      })
    ).toThrow(/Local server entry not found/);
  });
});

describe("parseServerHandshakeLine", () => {
  it("accepts the startup handshake payload", () => {
    const handshake = parseServerHandshakeLine(JSON.stringify(createHandshake()));

    expect(handshake).toEqual(createHandshake());
  });

  it("ignores non-handshake lines", () => {
    expect(parseServerHandshakeLine("Local server ready")).toBeNull();
    expect(parseServerHandshakeLine("{\"type\":\"different\"}")).toBeNull();
  });
});

describe("validateLocalServerHandshake", () => {
  it("accepts matching shell and server versions", () => {
    expect(validateLocalServerHandshake(createHandshake("0.1.0"), "0.1.0")).toEqual(createHandshake("0.1.0"));
  });

  it("rejects version mismatch so the shell fails fast", () => {
    expect(() => validateLocalServerHandshake(createHandshake("0.2.0"), "0.1.0")).toThrow(
      /Local server version mismatch/
    );
  });
});

describe("LocalServerProcess", () => {
  it("passes bootstrap diagnostics through the child environment", async () => {
    const child = new FakeChildProcess();
    const spawnCalls: Array<{
      command: string;
      args: readonly string[];
      options: Record<string, unknown>;
    }> = [];
    const spawnProcess = ((command: string, args?: readonly string[], options?: object) => {
      spawnCalls.push({
        command,
        args: [...(args ?? [])],
        options: (options ?? {}) as Record<string, unknown>
      });
      return asChildProcess(child);
    }) as LocalServerProcessOptions["spawnProcess"];
    const process = new LocalServerProcess({
      entryOverride: "/tmp/server.js",
      bootstrapId: "boot-123",
      serverLogFilePath: "/tmp/server-bootstrap.ndjson",
      expectedVersion: "0.1.0",
      pathExists: () => true,
      spawnProcess
    }, createSilentLogger());

    const startPromise = process.start();
    child.stdout.write(`${JSON.stringify(createHandshake())}\n`);
    await expect(startPromise).resolves.toEqual(createHandshake());

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toEqual(
      expect.objectContaining({
        command: globalThis.process.execPath,
        args: ["/tmp/server.js"],
        options: expect.objectContaining({
          env: expect.objectContaining({
            CODEX_REALTIME_BOOTSTRAP_ID: "boot-123",
            CODEX_REALTIME_SERVER_LOG_PATH: "/tmp/server-bootstrap.ndjson"
          })
        })
      })
    );
  });

  it("fails when the readiness handshake times out", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    const process = new LocalServerProcess({
      entryOverride: "/tmp/server.js",
      startupTimeoutMs: 25,
      pathExists: () => true,
      spawnProcess: createSpawnProcess(child)
    }, createSilentLogger());

    const startPromise = process.start();
    const timeoutExpectation = expect(startPromise).rejects.toThrow(
      /Timed out waiting for local server handshake/
    );
    await vi.advanceTimersByTimeAsync(25);

    await timeoutExpectation;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("keeps only the tail of startup stderr in timeout errors", async () => {
    vi.useFakeTimers();
    const stderrWrite = vi
      .spyOn(globalThis.process.stderr, "write")
      .mockImplementation((() => true) as typeof globalThis.process.stderr.write);
    const child = new FakeChildProcess();
    const localServerProcess = new LocalServerProcess({
      entryOverride: "/tmp/server.js",
      startupTimeoutMs: 25,
      pathExists: () => true,
      spawnProcess: createSpawnProcess(child)
    }, createSilentLogger());

    const startPromise = localServerProcess.start().then(
      () => new Error("Expected startup to time out"),
      (error: unknown) => error as Error
    );

    child.stderr.write(`prefix-${"x".repeat(12_000)}-suffix`);
    await vi.advanceTimersByTimeAsync(25);

    const error = await startPromise;
    expect(stderrWrite).toHaveBeenCalled();
    expect(error.message).toContain("-suffix");
    expect(error.message).not.toContain("prefix-");
    expect(error.message.length).toBeLessThan(8_400);
  });

  it("still resolves the handshake after a large unterminated stdout preamble", async () => {
    const child = new FakeChildProcess();
    const localServerProcess = new LocalServerProcess({
      entryOverride: "/tmp/server.js",
      expectedVersion: "0.1.0",
      pathExists: () => true,
      spawnProcess: createSpawnProcess(child)
    }, createSilentLogger());

    const startPromise = localServerProcess.start();
    child.stdout.write("x".repeat(20_000));
    child.stdout.write(`\n${JSON.stringify(createHandshake())}\n`);

    await expect(startPromise).resolves.toEqual(createHandshake());
  });

  it("rejects version mismatch and stops the child", async () => {
    const child = new FakeChildProcess();
    const process = new LocalServerProcess({
      entryOverride: "/tmp/server.js",
      expectedVersion: "0.1.0",
      pathExists: () => true,
      spawnProcess: createSpawnProcess(child)
    }, createSilentLogger());

    const startPromise = process.start();
    child.stdout.write(`${JSON.stringify(createHandshake("0.2.0"))}\n`);

    await expect(startPromise).rejects.toThrow(/Local server version mismatch/);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("reports an unexpected post-ready exit", async () => {
    const child = new FakeChildProcess();
    const onUnexpectedExit = vi.fn();
    const process = new LocalServerProcess({
      entryOverride: "/tmp/server.js",
      expectedVersion: "0.1.0",
      onUnexpectedExit,
      pathExists: () => true,
      spawnProcess: createSpawnProcess(child)
    }, createSilentLogger());

    await expect(
      Promise.all([
        process.start(),
        Promise.resolve().then(() => {
          child.stdout.write(`${JSON.stringify(createHandshake())}\n`);
        })
      ]).then(([handshake]) => handshake)
    ).resolves.toEqual(createHandshake());

    child.exitCode = 1;
    child.emit("exit", 1, null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onUnexpectedExit).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 1,
        signal: null,
        entryPath: "/tmp/server.js",
        expectedVersion: "0.1.0",
        handshake: expect.objectContaining({
          version: "0.1.0"
        })
      })
    );
    expect(process.getHandshake()).toBeNull();
  });
});
