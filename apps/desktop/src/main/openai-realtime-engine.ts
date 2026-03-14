import { EventEmitter } from "node:events";
import type { RealtimeAudioChunk, RealtimeTranscriptEntry } from "@shared";
import { voiceApiKeyService } from "./voice-api-key-service";
import { normalizeRealtimeInputChunk } from "./voice-audio";

const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime";
const OPENAI_REALTIME_MODEL = "gpt-realtime";
const OPENAI_REALTIME_VOICE = "alloy";
const OPENAI_REALTIME_SAMPLE_RATE = 24_000;
const OPENAI_REALTIME_CHANNELS = 1;
const CONNECT_TIMEOUT_MS = 10_000;
const TURN_COMPLETION_TIMEOUT_MS = 45_000;
const DEFAULT_RESPONSE_INSTRUCTIONS =
  "Acknowledge briefly. Keep spoken replies short. Never claim you changed code directly. If the user asked for repo work, say you are handing it to Codex.";

type RealtimeServerEvent = Record<string, unknown> & {
  type?: string;
};

type PendingTurn = {
  committedItemId: string | null;
  responseDone: boolean;
  transcriptDone: boolean;
  settled: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readString = (value: unknown) => (typeof value === "string" ? value : null);

const buildRealtimeUrl = () => {
  const url = new URL(OPENAI_REALTIME_URL);
  url.searchParams.set("model", OPENAI_REALTIME_MODEL);
  return url.toString();
};

const requireApiKey = () => {
  const apiKey = voiceApiKeyService.getApiKey();

  if (!apiKey) {
    throw new Error("Add a valid OpenAI API key in Settings > Voice.");
  }

  return apiKey;
};

const createTranscriptId = (speaker: RealtimeTranscriptEntry["speaker"], itemId: string) =>
  `${speaker}:${itemId}`;

const decodeMessageData = (data: unknown) => {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof Buffer) {
    return data.toString("utf8");
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }

  return "";
};

export class OpenAiRealtimeEngine extends EventEmitter<{
  ready: [sessionId: string | null];
  audio: [audio: RealtimeAudioChunk];
  transcript: [entry: RealtimeTranscriptEntry];
  error: [message: string];
  closed: [reason: string | null];
}> {
  private socket: WebSocket | null = null;
  private sessionId: string | null = null;
  private pendingReady:
    | {
        resolve: () => void;
        reject: (error: Error) => void;
        timeoutId: ReturnType<typeof setTimeout>;
      }
    | null = null;
  private pendingTurn: PendingTurn | null = null;
  private assistantTranscriptBuffer = new Map<string, string>();
  private userTranscriptBuffer = new Map<string, string>();
  private closedIntentionally = false;

  async start(instructions: string) {
    await this.dispose();

    const apiKey = requireApiKey();
    this.closedIntentionally = false;

    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Realtime voice connection timed out."));
      }, CONNECT_TIMEOUT_MS);

      this.pendingReady = {
        resolve: () => {
          clearTimeout(timeoutId);
          this.pendingReady = null;
          resolve();
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          this.pendingReady = null;
          reject(error);
        },
        timeoutId
      };

      const socket = new WebSocket(buildRealtimeUrl(), {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      });

      this.socket = socket;
      socket.addEventListener("open", () => {
        this.send({
          type: "session.update",
          session: {
            type: "realtime",
            instructions,
            voice: OPENAI_REALTIME_VOICE,
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
            input_audio_transcription: {
              model: "gpt-4o-transcribe"
            },
            turn_detection: null,
            max_response_output_tokens: 256
          }
        });
      });
      socket.addEventListener("message", (event) => {
        this.handleSocketMessage(event.data);
      });
      socket.addEventListener("close", () => {
        this.handleSocketClosed();
      });
      socket.addEventListener("error", () => {
        this.handleSocketError("Realtime voice websocket failed.");
      });
    });

    return this.sessionId;
  }

  async appendAudio(chunk: RealtimeAudioChunk) {
    const normalized = normalizeRealtimeInputChunk(chunk);

    this.send({
      type: "input_audio_buffer.append",
      audio: normalized.data
    });
  }

  async appendText(text: string) {
    const transcript = text.trim();

    if (!transcript) {
      return;
    }

    this.beginPendingTurn();
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: transcript
          }
        ]
      }
    });
    this.send({
      type: "response.create",
      response: {
        instructions: DEFAULT_RESPONSE_INSTRUCTIONS,
        modalities: ["audio"]
      }
    });
    await this.awaitPendingTurn();
  }

  async completeTurn() {
    this.beginPendingTurn();
    this.send({
      type: "input_audio_buffer.commit"
    });
    this.send({
      type: "response.create",
      response: {
        instructions: DEFAULT_RESPONSE_INSTRUCTIONS,
        modalities: ["audio"]
      }
    });
    await this.awaitPendingTurn();
  }

  async completeTurnAndStop() {
    try {
      await this.completeTurn();
    } finally {
      await this.dispose();
    }
  }

  async stop() {
    await this.dispose();
  }

  async dispose() {
    const socket = this.socket;

    this.socket = null;
    this.sessionId = null;
    this.assistantTranscriptBuffer.clear();
    this.userTranscriptBuffer.clear();
    this.rejectPendingReady(new Error("Realtime voice session closed."));
    this.rejectPendingTurn(new Error("Realtime voice session closed."));

    if (!socket) {
      return;
    }

    this.closedIntentionally = true;

    if (socket.readyState === WebSocket.CLOSED) {
      return;
    }

    await new Promise<void>((resolve) => {
      const settle = () => resolve();

      socket.addEventListener("close", settle, { once: true });

      try {
        socket.close();
      } catch {
        resolve();
      }
    });
  }

  private beginPendingTurn() {
    this.rejectPendingTurn(new Error("Previous realtime turn was replaced."));
    const timeoutId = setTimeout(() => {
      this.rejectPendingTurn(new Error("Realtime voice response timed out."));
    }, TURN_COMPLETION_TIMEOUT_MS);

    this.pendingTurn = {
      committedItemId: null,
      responseDone: false,
      transcriptDone: false,
      settled: false,
      resolve: () => undefined,
      reject: () => undefined,
      timeoutId
    };
  }

  private awaitPendingTurn() {
    const pendingTurn = this.pendingTurn;

    if (!pendingTurn) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      pendingTurn.resolve = resolve;
      pendingTurn.reject = reject;
      this.maybeResolvePendingTurn();
    });
  }

  private maybeResolvePendingTurn() {
    const pendingTurn = this.pendingTurn;

    if (
      !pendingTurn ||
      pendingTurn.settled ||
      !pendingTurn.responseDone ||
      (pendingTurn.committedItemId !== null && !pendingTurn.transcriptDone)
    ) {
      return;
    }

    pendingTurn.settled = true;
    clearTimeout(pendingTurn.timeoutId);
    pendingTurn.resolve();
    this.pendingTurn = null;
  }

  private rejectPendingReady(error: Error) {
    const pendingReady = this.pendingReady;

    if (!pendingReady) {
      return;
    }

    clearTimeout(pendingReady.timeoutId);
    this.pendingReady = null;
    pendingReady.reject(error);
  }

  private rejectPendingTurn(error: Error) {
    const pendingTurn = this.pendingTurn;

    if (!pendingTurn || pendingTurn.settled) {
      return;
    }

    pendingTurn.settled = true;
    clearTimeout(pendingTurn.timeoutId);
    this.pendingTurn = null;
    pendingTurn.reject(error);
  }

  private send(payload: Record<string, unknown>) {
    const socket = this.socket;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Realtime voice session is not connected.");
    }

    socket.send(JSON.stringify(payload));
  }

  private handleSocketMessage(data: unknown) {
    const rawPayload = decodeMessageData(data);

    if (!rawPayload) {
      return;
    }

    let payload: RealtimeServerEvent;

    try {
      payload = JSON.parse(rawPayload) as RealtimeServerEvent;
    } catch {
      return;
    }

    switch (payload.type) {
      case "session.created":
      case "session.updated": {
        const session = isRecord(payload.session) ? payload.session : null;
        this.sessionId = readString(session?.id) ?? this.sessionId;

        if (payload.type === "session.updated") {
          this.pendingReady?.resolve();
          this.emit("ready", this.sessionId);
        }
        return;
      }

      case "input_audio_buffer.committed": {
        if (this.pendingTurn) {
          this.pendingTurn.committedItemId = readString(payload.item_id);
        }
        return;
      }

      case "conversation.item.input_audio_transcription.delta": {
        const itemId = readString(payload.item_id);
        const delta = readString(payload.delta);

        if (!itemId || !delta) {
          return;
        }

        const nextTranscript = `${this.userTranscriptBuffer.get(itemId) ?? ""}${delta}`;
        this.userTranscriptBuffer.set(itemId, nextTranscript);
        this.emit("transcript", {
          id: createTranscriptId("user", itemId),
          speaker: "user",
          text: nextTranscript,
          status: "partial",
          createdAt: new Date().toISOString()
        });
        return;
      }

      case "conversation.item.input_audio_transcription.completed": {
        const itemId = readString(payload.item_id);
        const transcript = readString(payload.transcript);

        if (!itemId || !transcript) {
          return;
        }

        this.userTranscriptBuffer.set(itemId, transcript);
        this.emit("transcript", {
          id: createTranscriptId("user", itemId),
          speaker: "user",
          text: transcript,
          status: "final",
          createdAt: new Date().toISOString()
        });

        if (this.pendingTurn?.committedItemId === itemId) {
          this.pendingTurn.transcriptDone = true;
          this.maybeResolvePendingTurn();
        }
        return;
      }

      case "conversation.item.input_audio_transcription.failed": {
        const message =
          readString(isRecord(payload.error) ? payload.error.message : null) ??
          "Realtime voice transcription failed.";

        this.handleSocketError(message);
        return;
      }

      case "response.output_audio.delta": {
        const chunk = readString(payload.delta);

        if (!chunk) {
          return;
        }

        this.emit("audio", {
          data: chunk,
          sampleRate: OPENAI_REALTIME_SAMPLE_RATE,
          numChannels: OPENAI_REALTIME_CHANNELS,
          samplesPerChannel: null
        });
        return;
      }

      case "response.output_audio_transcript.delta": {
        const itemId = readString(payload.item_id);
        const delta = readString(payload.delta);

        if (!itemId || !delta) {
          return;
        }

        const nextTranscript = `${this.assistantTranscriptBuffer.get(itemId) ?? ""}${delta}`;
        this.assistantTranscriptBuffer.set(itemId, nextTranscript);
        this.emit("transcript", {
          id: createTranscriptId("assistant", itemId),
          speaker: "assistant",
          text: nextTranscript,
          status: "partial",
          createdAt: new Date().toISOString()
        });
        return;
      }

      case "response.output_audio_transcript.done": {
        const itemId = readString(payload.item_id);
        const transcript = readString(payload.transcript);

        if (!itemId || !transcript) {
          return;
        }

        this.assistantTranscriptBuffer.set(itemId, transcript);
        this.emit("transcript", {
          id: createTranscriptId("assistant", itemId),
          speaker: "assistant",
          text: transcript,
          status: "final",
          createdAt: new Date().toISOString()
        });
        return;
      }

      case "response.done": {
        if (this.pendingTurn) {
          this.pendingTurn.responseDone = true;

          if (this.pendingTurn.committedItemId === null) {
            this.pendingTurn.transcriptDone = true;
          }
        }
        this.maybeResolvePendingTurn();
        return;
      }

      case "error": {
        const message =
          readString(isRecord(payload.error) ? payload.error.message : null) ??
          readString(payload.message) ??
          "Realtime voice request failed.";

        this.handleSocketError(message);
        return;
      }

      default:
        return;
    }
  }

  private handleSocketError(message: string) {
    const error = new Error(message);
    this.emit("error", message);
    this.rejectPendingReady(error);
    this.rejectPendingTurn(error);
  }

  private handleSocketClosed() {
    if (this.closedIntentionally) {
      this.emit("closed", null);
      return;
    }

    const error = new Error("Realtime voice connection closed unexpectedly.");
    this.emit("closed", error.message);
    this.emit("error", error.message);
    this.rejectPendingReady(error);
    this.rejectPendingTurn(error);
  }
}

export const openAiRealtimeEngine = new OpenAiRealtimeEngine();
