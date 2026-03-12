import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type {
  CodexAccountSummary,
  CodexFeatureFlags,
  RealtimeAudioChunk,
  SessionState,
  WorkerExecutionSettings
} from "@shared";
import { CodexBridgeFixture } from "./codex-bridge-fixture";

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
};

type PendingRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
};

type ServerNotificationMessage = {
  method: string;
  params?: unknown;
};

type ServerRequestMessage = {
  id: string;
  method: string;
  params?: unknown;
};

const emptyFeatures = (): CodexFeatureFlags => ({
  defaultModeRequestUserInput: false,
  realtimeConversation: false,
  voiceTranscription: false
});

const now = () => new Date().toISOString();
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_STDOUT_BUFFER_BYTES = 1_048_576;
const DEFAULT_MAX_STDOUT_LINE_BYTES = 262_144;
const MALFORMED_MESSAGE_ERROR = "Codex app-server sent malformed JSON";
const OVERSIZED_STDOUT_BUFFER_ERROR =
  "Codex app-server sent oversized stdout payload without newline";
const OVERSIZED_STDOUT_LINE_ERROR = "Codex app-server sent oversized stdout line";

const normalizeError = (error: unknown, fallback: string) =>
  error instanceof Error ? error : new Error(fallback);
const utf8ByteLength = (value: string) => Buffer.byteLength(value, "utf8");

export class CodexBridge extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private bufferByteLength = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private stdinWriteChain: Promise<void> = Promise.resolve();
  private startPromise: Promise<void> | null = null;
  private readonly fixture = process.env.CODEX_REALTIME_E2E_FIXTURE_PATH
    ? new CodexBridgeFixture(process.env.CODEX_REALTIME_E2E_FIXTURE_PATH)
    : null;
  private readonly requestTimeoutMs: number;
  private readonly maxStdoutBufferBytes: number;
  private readonly maxStdoutLineBytes: number;
  private state: SessionState = {
    status: "connecting",
    account: null,
    features: emptyFeatures(),
    requiresOpenaiAuth: true,
    error: null,
    lastUpdatedAt: null
  };

  constructor(options?: {
    requestTimeoutMs?: number;
    maxStdoutBufferBytes?: number;
    maxStdoutLineBytes?: number;
  }) {
    super();
    this.requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxStdoutBufferBytes = options?.maxStdoutBufferBytes ?? DEFAULT_MAX_STDOUT_BUFFER_BYTES;
    this.maxStdoutLineBytes = Math.min(
      options?.maxStdoutLineBytes ?? DEFAULT_MAX_STDOUT_LINE_BYTES,
      this.maxStdoutBufferBytes
    );
  }

  async start() {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startInternal().catch((error) => {
      this.startPromise = null;
      throw error;
    });
    return this.startPromise;
  }

  getState(): SessionState {
    return this.state;
  }

  async startThread(cwd: string) {
    await this.start();

    if (this.fixture) {
      return this.fixture.startThread(cwd);
    }

    return this.request("thread/start", {
      cwd,
      approvalPolicy: "untrusted",
      experimentalRawEvents: false,
      persistExtendedHistory: true
    });
  }

  async resumeThread(threadId: string, cwd: string) {
    await this.start();

    if (this.fixture) {
      return this.fixture.resumeThread(threadId, cwd);
    }

    return this.request("thread/resume", {
      threadId,
      cwd,
      persistExtendedHistory: true
    });
  }

  async listThreads(cwd: string, archived = false) {
    await this.start();

    if (this.fixture) {
      return this.fixture.listThreads(cwd, archived);
    }

    return this.request("thread/list", {
      cwd,
      archived,
      limit: 20
    });
  }

  async archiveThread(threadId: string) {
    await this.start();

    if (this.fixture) {
      return this.fixture.archiveThread(threadId);
    }

    return this.request("thread/archive", {
      threadId
    });
  }

  async unarchiveThread(threadId: string) {
    await this.start();

    if (this.fixture) {
      return this.fixture.unarchiveThread(threadId);
    }

    return this.request("thread/unarchive", {
      threadId
    });
  }

  async readThread(threadId: string) {
    await this.start();

    if (this.fixture) {
      return this.fixture.readThread(threadId);
    }

    return this.request("thread/read", {
      threadId,
      includeTurns: true
    });
  }

  async listModels(cursor?: string | null) {
    await this.start();

    if (this.fixture) {
      return this.fixture.listModels();
    }

    return this.request("model/list", {
      cursor: cursor ?? null,
      limit: 100,
      includeHidden: false
    });
  }

  async listCollaborationModes() {
    await this.start();

    if (this.fixture) {
      return this.fixture.listCollaborationModes();
    }

    return this.request("collaborationMode/list", {});
  }

  async readConfig(cwd?: string | null) {
    await this.start();

    if (this.fixture) {
      return this.fixture.readConfig();
    }

    return this.request("config/read", {
      includeLayers: false,
      cwd: cwd ?? null
    });
  }

  async getConversationSummary(threadId: string) {
    await this.start();

    if (this.fixture) {
      return this.fixture.getConversationSummary(threadId);
    }

    return this.request("getConversationSummary", {
      conversationId: threadId
    });
  }

  async setThreadName(threadId: string, name: string) {
    await this.start();

    if (this.fixture) {
      return this.fixture.setThreadName(threadId, name);
    }

    return this.request("thread/name/set", {
      threadId,
      name
    });
  }

  async startTurn(
    threadId: string,
    input: unknown[],
    settings: WorkerExecutionSettings,
    resolvedModel: string | null = settings.model
  ) {
    await this.start();

    if (this.fixture) {
      return this.fixture.startTurn(threadId, input, settings, resolvedModel);
    }

    return this.request("turn/start", {
      threadId,
      input,
      approvalPolicy: settings.approvalPolicy,
      model: settings.model,
      serviceTier: settings.fastMode ? "fast" : "flex",
      effort: settings.reasoningEffort,
      collaborationMode:
        settings.collaborationMode === "plan" && resolvedModel
          ? {
              mode: settings.collaborationMode,
              settings: {
                model: resolvedModel,
                reasoning_effort: settings.reasoningEffort,
                developer_instructions: null
              }
            }
          : null
    });
  }

  async steerTurn(threadId: string, expectedTurnId: string, prompt: string) {
    await this.start();

    if (this.fixture) {
      return this.fixture.steerTurn(threadId, expectedTurnId, prompt);
    }

    return this.request("turn/steer", {
      threadId,
      expectedTurnId,
      input: [
        {
          type: "text",
          text: prompt,
          text_elements: []
        }
      ]
    });
  }

  async interruptTurn(threadId: string, turnId: string) {
    await this.start();

    if (this.fixture) {
      return this.fixture.interruptTurn(threadId, turnId);
    }

    return this.request("turn/interrupt", {
      threadId,
      turnId
    });
  }

  async startRealtime(threadId: string, prompt: string, sessionId?: string | null) {
    await this.start();

    if (this.fixture) {
      return this.fixture.startRealtime(threadId, prompt, sessionId);
    }

    return this.request("thread/realtime/start", {
      threadId,
      prompt,
      sessionId
    });
  }

  async appendRealtimeAudio(threadId: string, audio: RealtimeAudioChunk) {
    await this.start();

    if (this.fixture) {
      return this.fixture.appendRealtimeAudio();
    }

    return this.request("thread/realtime/appendAudio", {
      threadId,
      audio
    });
  }

  async appendRealtimeText(threadId: string, text: string) {
    await this.start();

    if (this.fixture) {
      return this.fixture.appendRealtimeText();
    }

    return this.request("thread/realtime/appendText", {
      threadId,
      text
    });
  }

  async stopRealtime(threadId: string) {
    await this.start();

    if (this.fixture) {
      return this.fixture.stopRealtime();
    }

    return this.request("thread/realtime/stop", {
      threadId
    });
  }

  async respond(id: string, result: unknown) {
    await this.start();

    if (this.fixture) {
      this.fixture.respond();
      return;
    }

    if (!this.child) {
      throw new Error("Codex app-server is not running");
    }

    await this.writeMessage({
      jsonrpc: "2.0",
      id,
      result
    });
  }

  async refreshState(): Promise<SessionState> {
    if (this.fixture) {
      await this.start();
      this.state = this.fixture.refreshState();
      this.emit("stateChanged", this.state);
      return this.state;
    }

    try {
      await this.start();
      const [accountResult, featureResult] = await Promise.all([
        this.request("account/read", {}),
        this.request("experimentalFeature/list", {})
      ]);

      this.state = {
        status: "connected",
        account: this.mapAccount((accountResult as { account?: unknown }).account),
        features: this.mapFeatures((featureResult as { data?: unknown[] }).data ?? []),
        requiresOpenaiAuth: Boolean((accountResult as { requiresOpenaiAuth?: boolean }).requiresOpenaiAuth),
        error: null,
        lastUpdatedAt: now()
      };
    } catch (error) {
      this.state = {
        ...this.state,
        status: "error",
        error: error instanceof Error ? error.message : "Unknown Codex bridge error",
        lastUpdatedAt: now()
      };
    }

    this.emit("stateChanged", this.state);
    return this.state;
  }

  async stop() {
    if (this.fixture) {
      this.startPromise = null;
      return;
    }

    if (!this.child) {
      this.stdinWriteChain = Promise.resolve();
      this.startPromise = null;
      return;
    }

    const child = this.child;
    this.child = null;
    this.clearBuffer();
    this.stdinWriteChain = Promise.resolve();
    this.startPromise = null;
    this.rejectAllPending("Codex app-server stopped before responding");
    child.kill("SIGTERM");
  }

  private async startInternal() {
    this.state = {
      ...this.state,
      status: "connecting",
      error: null
    };

    if (this.fixture) {
      return;
    }

    this.clearBuffer();
    this.stdinWriteChain = Promise.resolve();
    this.child = spawn("codex", ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.handleStdout(chunk));

    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      const message = chunk.trim();
      if (!message) {
        return;
      }

      this.state = {
        ...this.state,
        error: message,
        lastUpdatedAt: now()
      };
      this.emit("stateChanged", this.state);
    });

    this.child.on("exit", () => this.handleChildExit());

    await this.request("initialize", {
      clientInfo: {
        name: "codex-realtime-desktop",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true
      }
    });
  }

  private handleStdout(chunk: string) {
    const chunkByteLength = utf8ByteLength(chunk);
    if (this.bufferByteLength + chunkByteLength > this.maxStdoutBufferBytes) {
      this.clearBuffer();
      this.state = {
        ...this.state,
        error: `${OVERSIZED_STDOUT_BUFFER_ERROR}: exceeded ${this.maxStdoutBufferBytes} bytes`,
        lastUpdatedAt: now()
      };
      this.emit("stateChanged", this.state);
      return;
    }

    this.buffer += chunk;
    this.bufferByteLength += chunkByteLength;

    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }

      const consumedChunk = this.buffer.slice(0, newlineIndex + 1);
      this.bufferByteLength -= utf8ByteLength(consumedChunk);
      const rawLine = consumedChunk.slice(0, -1);
      if (utf8ByteLength(rawLine) > this.maxStdoutLineBytes) {
        this.state = {
          ...this.state,
          error: `${OVERSIZED_STDOUT_LINE_ERROR}: exceeded ${this.maxStdoutLineBytes} bytes`,
          lastUpdatedAt: now()
        };
        this.emit("stateChanged", this.state);
        this.buffer = this.buffer.slice(newlineIndex + 1);
        continue;
      }

      const line = rawLine.trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (!line) {
        continue;
      }

      let message: JsonRpcMessage;

      try {
        message = JSON.parse(line) as JsonRpcMessage;
      } catch (error) {
        this.state = {
          ...this.state,
          error: `${MALFORMED_MESSAGE_ERROR}: ${normalizeError(error, MALFORMED_MESSAGE_ERROR).message}`,
          lastUpdatedAt: now()
        };
        this.emit("stateChanged", this.state);
        continue;
      }

      const messageId = typeof message.id === "string" ? message.id : null;
      const messageMethod = typeof message.method === "string" ? message.method : null;

      if (messageId && this.pending.has(messageId)) {
        if (message.error) {
          this.rejectPendingRequest(messageId, message.error.message);
        } else {
          this.resolvePendingRequest(messageId, message.result);
        }

        continue;
      }

      if (messageMethod && messageId) {
        this.emit("serverRequest", {
          id: messageId,
          method: messageMethod,
          params: message.params
        } satisfies ServerRequestMessage);
        continue;
      }

      if (messageMethod) {
        this.emit("notification", {
          method: messageMethod,
          params: message.params
        } satisfies ServerNotificationMessage);
      }
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.child) {
      return Promise.reject(new Error("Codex app-server is not running"));
    }

    const id = randomUUID();

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.rejectPendingRequest(id, `Codex app-server request timed out: ${method}`);
      }, this.requestTimeoutMs);

      this.pending.set(id, {
        method,
        resolve,
        reject,
        timeoutId
      });

      void this.writeMessage({ jsonrpc: "2.0", id, method, params }).catch((error) => {
        this.rejectPendingRequest(
          id,
          normalizeError(error, `Failed to send Codex app-server request: ${method}`).message
        );
      });
    });
  }

  private handleChildExit() {
    this.child = null;
    this.clearBuffer();
    this.stdinWriteChain = Promise.resolve();
    this.startPromise = null;
    this.rejectAllPending("Codex app-server exited before responding");
    this.state = {
      ...this.state,
      status: "error",
      error: this.state.error ?? "Codex app-server exited unexpectedly",
      lastUpdatedAt: now()
    };
    this.emit("stateChanged", this.state);
  }

  private async writeMessage(message: JsonRpcMessage) {
    const payload = `${JSON.stringify(message)}\n`;
    const runWrite = async () => {
      const child = this.child;
      if (!child) {
        throw new Error("Codex app-server is not running");
      }

      await new Promise<void>((resolve, reject) => {
        let needsDrain = false;
        let settled = false;

        const cleanup = () => {
          child.stdin.off("drain", handleDrain);
          child.stdin.off("error", handleError);
          child.off("exit", handleExit);
        };

        const settle = (error?: Error) => {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();

          if (error) {
            reject(error);
            return;
          }

          resolve();
        };

        const handleDrain = () => settle();
        const handleError = (error: Error) =>
          settle(normalizeError(error, "Failed to write to Codex app-server"));
        const handleExit = () =>
          settle(new Error("Codex app-server exited before request write completed"));

        child.stdin.once("error", handleError);
        child.once("exit", handleExit);

        try {
          needsDrain = !child.stdin.write(payload, (error?: Error | null) => {
            if (error) {
              settle(normalizeError(error, "Failed to write to Codex app-server"));
              return;
            }

            if (!needsDrain) {
              settle();
            }
          });
        } catch (error) {
          settle(normalizeError(error, "Failed to write to Codex app-server"));
          return;
        }

        if (needsDrain) {
          child.stdin.once("drain", handleDrain);
        }
      });
    };

    const writePromise = this.stdinWriteChain.then(runWrite, runWrite);
    this.stdinWriteChain = writePromise.catch(() => {});
    await writePromise;
  }

  private resolvePendingRequest(id: string, result: unknown) {
    const pending = this.pending.get(id);

    if (!pending) {
      return;
    }

    this.pending.delete(id);
    clearTimeout(pending.timeoutId);
    pending.resolve(result);
  }

  private rejectPendingRequest(id: string, message: string) {
    const pending = this.pending.get(id);

    if (!pending) {
      return;
    }

    this.pending.delete(id);
    clearTimeout(pending.timeoutId);
    pending.reject(new Error(message));
  }

  private rejectAllPending(message: string) {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(`${message}: ${pending.method}`));
      this.pending.delete(id);
    }
  }

  private clearBuffer() {
    this.buffer = "";
    this.bufferByteLength = 0;
  }

  private mapAccount(account: unknown): CodexAccountSummary | null {
    if (!account || typeof account !== "object") {
      return null;
    }

    const raw = account as Record<string, unknown>;
    const type = raw.type === "chatgpt" || raw.type === "apiKey" ? raw.type : "unknown";

    return {
      type,
      email: typeof raw.email === "string" ? raw.email : undefined,
      planType: typeof raw.planType === "string" ? raw.planType : undefined
    };
  }

  private mapFeatures(features: unknown[]): CodexFeatureFlags {
    const enabled = new Set(
      features
        .map((feature) => {
          if (!feature || typeof feature !== "object") {
            return null;
          }

          const raw = feature as Record<string, unknown>;
          return raw.enabled === true && typeof raw.name === "string" ? raw.name : null;
        })
        .filter((name): name is string => Boolean(name))
    );

    return {
      defaultModeRequestUserInput: enabled.has("default_mode_request_user_input"),
      realtimeConversation: enabled.has("realtime_conversation"),
      voiceTranscription: enabled.has("voice_transcription")
    };
  }
}

export const codexBridge = new CodexBridge();
