import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeAudioChunk } from "@shared";
import { normalizeRealtimeInputChunk } from "./voice-audio";

type SocketListener = (event?: { data?: string }) => void;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  private listeners = new Map<string, SocketListener[]>();

  constructor(
    readonly url: string,
    readonly options?: {
      headers?: Record<string, string>;
    }
  ) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: SocketListener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close");
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open");
  }

  message(payload: Record<string, unknown>) {
    this.emit("message", { data: JSON.stringify(payload) });
  }

  fail() {
    this.emit("error");
  }

  private emit(type: string, event?: { data?: string }) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe("OpenAiRealtimeEngine", () => {
  beforeEach(() => {
    vi.resetModules();
    MockWebSocket.instances = [];
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      writable: true,
      value: MockWebSocket
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends session.update after connecting and resolves once the session is ready", async () => {
    vi.doMock("./voice-api-key-service", () => ({
      voiceApiKeyService: {
        getApiKey: vi.fn(() => "sk-test")
      }
    }));

    const { OpenAiRealtimeEngine } = await import("./openai-realtime-engine");
    const engine = new OpenAiRealtimeEngine();
    const startPromise = engine.start("Keep replies short.");
    await Promise.resolve();
    const socket = MockWebSocket.instances[0]!;

    expect(socket.url).toContain("wss://api.openai.com/v1/realtime");
    expect(socket.options?.headers?.Authorization).toBe("Bearer sk-test");

    socket.open();
    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
      type: "session.update",
      session: expect.objectContaining({
        type: "realtime",
        instructions: "Keep replies short.",
        input_audio_transcription: {
          model: "gpt-4o-transcribe"
        },
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        voice: "alloy"
      })
    });

    socket.message({
      type: "session.updated",
      session: {
        id: "rt-session-1"
      }
    });

    await expect(startPromise).resolves.toBe("rt-session-1");
  });

  it("normalizes outgoing audio chunks before appending them to the input buffer", async () => {
    vi.doMock("./voice-api-key-service", () => ({
      voiceApiKeyService: {
        getApiKey: vi.fn(() => "sk-test")
      }
    }));

    const { OpenAiRealtimeEngine } = await import("./openai-realtime-engine");
    const engine = new OpenAiRealtimeEngine();
    const startPromise = engine.start("Keep replies short.");
    await Promise.resolve();
    const socket = MockWebSocket.instances[0]!;
    socket.open();
    socket.message({
      type: "session.updated",
      session: {
        id: "rt-session-2"
      }
    });
    await startPromise;

    const chunk: RealtimeAudioChunk = {
      data: Buffer.from(new Int16Array([100, -100, 200, -200]).buffer).toString("base64"),
      sampleRate: 48_000,
      numChannels: 2,
      samplesPerChannel: 2
    };

    await engine.appendAudio(chunk);

    expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toEqual({
      type: "input_audio_buffer.append",
      audio: normalizeRealtimeInputChunk(chunk).data
    });
  });

  it("waits for response completion and final user transcription before completing a turn", async () => {
    vi.doMock("./voice-api-key-service", () => ({
      voiceApiKeyService: {
        getApiKey: vi.fn(() => "sk-test")
      }
    }));

    const { OpenAiRealtimeEngine } = await import("./openai-realtime-engine");
    const engine = new OpenAiRealtimeEngine();
    const transcripts: string[] = [];
    engine.on("transcript", (entry) => {
      transcripts.push(`${entry.speaker}:${entry.text}:${entry.status}`);
    });

    const startPromise = engine.start("Keep replies short.");
    await Promise.resolve();
    const socket = MockWebSocket.instances[0]!;
    socket.open();
    socket.message({
      type: "session.updated",
      session: {
        id: "rt-session-3"
      }
    });
    await startPromise;

    const completionPromise = engine.completeTurn();
    expect(JSON.parse(socket.sent.at(-2) ?? "{}")).toEqual({
      type: "input_audio_buffer.commit"
    });
    expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toMatchObject({
      type: "response.create",
      response: expect.objectContaining({
        modalities: ["audio"]
      })
    });

    socket.message({
      type: "input_audio_buffer.committed",
      item_id: "user-item-1"
    });
    socket.message({
      type: "response.done"
    });

    let settled = false;
    void completionPromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    socket.message({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "user-item-1",
      delta: "Inspect src/"
    });
    socket.message({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "user-item-1",
      transcript: "Inspect src/App.tsx"
    });

    await expect(completionPromise).resolves.toBeUndefined();
    expect(transcripts).toEqual([
      "user:Inspect src/:partial",
      "user:Inspect src/App.tsx:final"
    ]);
  });
});
