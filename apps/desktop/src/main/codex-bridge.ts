import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type {
  CodexAccountSummary,
  CodexFeatureFlags,
  SessionState
} from "@shared";

type JsonRpcMessage = {
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
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

const emptyFeatures = (): CodexFeatureFlags => ({
  defaultModeRequestUserInput: false,
  realtimeConversation: false,
  voiceTranscription: false
});

const now = () => new Date().toISOString();

class CodexBridge extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private readonly pending = new Map<string, PendingRequest>();
  private startPromise: Promise<void> | null = null;
  private state: SessionState = {
    status: "connecting",
    account: null,
    features: emptyFeatures(),
    requiresOpenaiAuth: true,
    error: null,
    lastUpdatedAt: null
  };

  async start() {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startInternal();
    return this.startPromise;
  }

  getState(): SessionState {
    return this.state;
  }

  async startThread(cwd: string) {
    await this.start();

    return this.request("thread/start", {
      cwd,
      approvalPolicy: "untrusted",
      experimentalRawEvents: false,
      persistExtendedHistory: true
    });
  }

  async resumeThread(threadId: string, cwd: string) {
    await this.start();

    return this.request("thread/resume", {
      threadId,
      cwd,
      persistExtendedHistory: true
    });
  }

  async listThreads(cwd: string) {
    await this.start();

    return this.request("thread/list", {
      cwd,
      archived: false,
      limit: 20
    });
  }

  async readThread(threadId: string) {
    await this.start();

    return this.request("thread/read", {
      threadId,
      includeTurns: true
    });
  }

  async startTurn(threadId: string, prompt: string) {
    await this.start();

    return this.request("turn/start", {
      threadId,
      input: [
        {
          type: "text",
          text: prompt,
          text_elements: []
        }
      ]
    });
  }

  async refreshState(): Promise<SessionState> {
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
    if (!this.child) {
      return;
    }

    this.child.kill("SIGTERM");
    this.child = null;
    this.startPromise = null;
  }

  private async startInternal() {
    this.state = {
      ...this.state,
      status: "connecting",
      error: null
    };

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

    this.child.on("exit", () => {
      this.child = null;
      this.startPromise = null;
      this.state = {
        ...this.state,
        status: "error",
        error: this.state.error ?? "Codex app-server exited unexpectedly",
        lastUpdatedAt: now()
      };
      this.emit("stateChanged", this.state);
    });

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
    this.buffer += chunk;

    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }

      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (!line) {
        continue;
      }

      const message = JSON.parse(line) as JsonRpcMessage;

      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id)!;
        this.pending.delete(message.id);

        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result);
        }
      }
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.child) {
      return Promise.reject(new Error("Codex app-server is not running"));
    }

    const id = randomUUID();

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child!.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`
      );
    });
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
