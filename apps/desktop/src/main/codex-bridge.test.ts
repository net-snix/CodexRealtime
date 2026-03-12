import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexBridge } from "./codex-bridge";

type WriteCallback = (error?: Error | null) => void;
type WriteImpl = (chunk: string, callback?: WriteCallback) => boolean;

class MockReadable extends EventEmitter {
  setEncoding(encoding: string) {
    void encoding;
  }
}

class MockWritable extends EventEmitter {
  readonly writes: string[] = [];

  constructor(private readonly writeImpl?: WriteImpl) {
    super();
  }

  write(chunk: string, callback?: WriteCallback) {
    this.writes.push(chunk);

    if (this.writeImpl) {
      return this.writeImpl(chunk, callback);
    }

    callback?.(null);
    return true;
  }
}

class MockChild extends EventEmitter {
  readonly stdout = new MockReadable();
  readonly stderr = new MockReadable();
  readonly stdin: MockWritable;
  readonly kill = vi.fn(() => true);

  constructor(writeImpl?: WriteImpl) {
    super();
    this.stdin = new MockWritable(writeImpl);
  }
}

const attachChild = (bridge: CodexBridge, child: MockChild) => {
  (bridge as unknown as { child: MockChild | null }).child = child;
  return child;
};

describe("CodexBridge", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("guards malformed JSON from stdout", () => {
    const bridge = new CodexBridge();

    expect(() => {
      (bridge as unknown as { handleStdout: (chunk: string) => void }).handleStdout("{oops}\n");
    }).not.toThrow();

    expect(bridge.getState().error).toContain("Codex app-server sent malformed JSON");
  });

  it("drops oversized stdout payloads without newline", () => {
    const bridge = new CodexBridge({ maxStdoutBufferBytes: 16 });

    (bridge as unknown as { handleStdout: (chunk: string) => void }).handleStdout("x".repeat(17));

    expect(bridge.getState().error).toContain("Codex app-server sent oversized stdout payload");
    expect((bridge as unknown as { buffer: string }).buffer).toBe("");
  });

  it("times out pending requests", async () => {
    vi.useFakeTimers();

    const bridge = new CodexBridge({ requestTimeoutMs: 25 });
    attachChild(bridge, new MockChild());

    const request = (
      bridge as unknown as { request: (method: string, params: unknown) => Promise<unknown> }
    ).request("model/list", {});
    const rejection = expect(request).rejects.toThrow(
      "Codex app-server request timed out: model/list"
    );

    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect((bridge as unknown as { pending: Map<string, unknown> }).pending.size).toBe(0);
  });

  it("clears pending requests on stop", async () => {
    const bridge = new CodexBridge({ requestTimeoutMs: 1_000 });
    const child = attachChild(bridge, new MockChild());
    const request = (
      bridge as unknown as { request: (method: string, params: unknown) => Promise<unknown> }
    ).request("thread/read", {});

    await bridge.stop();

    await expect(request).rejects.toThrow("Codex app-server stopped before responding: thread/read");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("clears pending requests when the child exits", async () => {
    const bridge = new CodexBridge({ requestTimeoutMs: 1_000 });
    attachChild(bridge, new MockChild());
    const request = (
      bridge as unknown as { request: (method: string, params: unknown) => Promise<unknown> }
    ).request("thread/read", {});

    (bridge as unknown as { handleChildExit: () => void }).handleChildExit();

    await expect(request).rejects.toThrow("Codex app-server exited before responding: thread/read");
    expect(bridge.getState().status).toBe("error");
  });

  it("waits for drain before completing a backpressured write", async () => {
    let writeCallback: WriteCallback | undefined;
    const bridge = new CodexBridge();
    const child = attachChild(
      bridge,
      new MockChild((_chunk, callback) => {
        writeCallback = callback;
        return false;
      })
    );

    let settled = false;
    const writePromise = (
      bridge as unknown as { writeMessage: (message: unknown) => Promise<void> }
    )
      .writeMessage({ jsonrpc: "2.0", method: "ping" })
      .then(() => {
        settled = true;
      });

    writeCallback?.(null);
    await Promise.resolve();
    expect(settled).toBe(false);

    child.stdin.emit("drain");
    await writePromise;

    expect(settled).toBe(true);
    expect(child.stdin.writes[0]).toContain("\"method\":\"ping\"");
  });

  it("serializes later writes until backpressure clears", async () => {
    let firstWriteCallback: WriteCallback | undefined;
    const bridge = new CodexBridge();
    const child = attachChild(
      bridge,
      new MockChild((chunk, callback) => {
        if (chunk.includes("\"method\":\"first\"")) {
          firstWriteCallback = callback;
          return false;
        }

        callback?.(null);
        return true;
      })
    );

    const firstWrite = (
      bridge as unknown as { writeMessage: (message: unknown) => Promise<void> }
    ).writeMessage({ jsonrpc: "2.0", method: "first" });
    const secondWrite = (
      bridge as unknown as { writeMessage: (message: unknown) => Promise<void> }
    ).writeMessage({ jsonrpc: "2.0", method: "second" });

    await Promise.resolve();
    expect(child.stdin.writes).toHaveLength(1);

    firstWriteCallback?.(null);
    await Promise.resolve();
    expect(child.stdin.writes).toHaveLength(1);

    child.stdin.emit("drain");
    await firstWrite;
    await Promise.resolve();

    expect(child.stdin.writes).toHaveLength(2);
    expect(child.stdin.writes[1]).toContain("\"method\":\"second\"");

    await secondWrite;
  });

  it("sends collaboration mode on turn start when plan mode is enabled", async () => {
    const bridge = new CodexBridge();
    const child = attachChild(bridge, new MockChild());
    (bridge as unknown as { startPromise: Promise<void> | null }).startPromise = Promise.resolve();

    const startTurnPromise = bridge.startTurn(
      "thread-1",
      [
        {
          type: "text",
          text: "Plan this change",
          text_elements: []
        }
      ],
      {
        model: "gpt-5.4",
        reasoningEffort: "xhigh",
        fastMode: true,
        approvalPolicy: "never",
        collaborationMode: "plan"
      },
      "gpt-5.4"
    );

    await vi.waitFor(() => {
      expect(child.stdin.writes[0]).toBeDefined();
    });

    const payload = JSON.parse(child.stdin.writes[0]) as {
      id: string;
      method: string;
      params: {
        collaborationMode?: {
          mode: string;
          settings: {
            model: string;
            reasoning_effort: string;
            developer_instructions: null;
          };
        } | null;
      };
    };

    expect(payload.method).toBe("turn/start");
    expect(payload.params.collaborationMode).toEqual({
      mode: "plan",
      settings: {
        model: "gpt-5.4",
        reasoning_effort: "xhigh",
        developer_instructions: null
      }
    });

    (bridge as unknown as { handleStdout: (chunk: string) => void }).handleStdout(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: {
          turn: {
            id: "turn-1"
          }
        }
      })}\n`
    );

    await expect(startTurnPromise).resolves.toEqual({
      turn: {
        id: "turn-1"
      }
    });
  });
});
