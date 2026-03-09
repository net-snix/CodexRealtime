import { EventEmitter } from "node:events";
import type { RealtimeAudioChunk, RealtimeEvent, RealtimeState, TimelineState } from "@shared";
import { codexBridge } from "./codex-bridge";
import { workspaceService } from "./workspace-service";
import { isRecord, type NotificationPayload } from "./workspace-timeline";

const DEFAULT_REALTIME_PROMPT =
  "You are a voice-native software engineering assistant. Keep replies concise, useful, and grounded in the current repo thread.";
const ACTION_VERBS = [
  "inspect",
  "check",
  "open",
  "look at",
  "search",
  "find",
  "fix",
  "change",
  "edit",
  "update",
  "refactor",
  "add",
  "remove",
  "rename",
  "run",
  "test",
  "build",
  "lint",
  "debug",
  "commit",
  "push"
];
const REPO_TARGETS = [
  "repo",
  "repository",
  "code",
  "file",
  "folder",
  "path",
  "module",
  "function",
  "component",
  "test",
  "diff",
  "command",
  "branch",
  "package",
  "workspace"
];

const cloneRealtimeState = (state: RealtimeState): RealtimeState => ({ ...state });
const isRealtimeAudioChunk = (value: unknown): value is RealtimeAudioChunk =>
  isRecord(value) &&
  typeof value.data === "string" &&
  typeof value.sampleRate === "number" &&
  typeof value.numChannels === "number" &&
  (typeof value.samplesPerChannel === "number" || value.samplesPerChannel === null);
const looksLikePathOrCommand = (value: string) =>
  /(?:\b[\w.-]+\.(?:ts|tsx|js|jsx|json|md|css|html|swift|py|sh)\b|\/[\w./-]+|\b(?:pnpm|npm|git|node|cargo|swift)\b)/i.test(
    value
  );
const shouldDelegatePrompt = (prompt: string) => {
  const normalizedPrompt = prompt.trim().toLowerCase();

  if (!normalizedPrompt) {
    return false;
  }

  const hasActionVerb = ACTION_VERBS.some((verb) => normalizedPrompt.includes(verb));
  const hasRepoTarget = REPO_TARGETS.some((target) => normalizedPrompt.includes(target));

  return (hasActionVerb && hasRepoTarget) || looksLikePathOrCommand(prompt);
};

class RealtimeService extends EventEmitter {
  private state: RealtimeState = {
    status: "idle",
    threadId: null,
    sessionId: null,
    error: null
  };

  constructor() {
    super();

    codexBridge.on("notification", (payload: NotificationPayload) => {
      this.handleNotification(payload);
    });
  }

  getState() {
    return cloneRealtimeState(this.state);
  }

  async start(prompt = DEFAULT_REALTIME_PROMPT) {
    const threadId = await workspaceService.getCurrentThreadId();
    const sessionId = this.state.threadId === threadId ? this.state.sessionId : null;

    this.state = {
      status: "connecting",
      threadId,
      sessionId,
      error: null
    };
    this.emitState();

    try {
      await codexBridge.startRealtime(threadId, prompt, sessionId);
      return this.getState();
    } catch (error) {
      this.state = {
        ...this.state,
        status: "error",
        error: error instanceof Error ? error.message : "Realtime start failed"
      };
      this.emitState();
      throw error;
    }
  }

  async stop() {
    if (!this.state.threadId) {
      return this.getState();
    }

    try {
      await codexBridge.stopRealtime(this.state.threadId);
    } finally {
      this.state = {
        status: "idle",
        threadId: this.state.threadId,
        sessionId: null,
        error: null
      };
      this.emitState();
    }

    return this.getState();
  }

  async appendAudio(audio: RealtimeAudioChunk) {
    if (!this.state.threadId) {
      throw new Error("Realtime is not started.");
    }

    await codexBridge.appendRealtimeAudio(this.state.threadId, audio);
  }

  async appendText(text: string) {
    if (!this.state.threadId) {
      throw new Error("Realtime is not started.");
    }

    await codexBridge.appendRealtimeText(this.state.threadId, text);
  }

  async dispatchVoicePrompt(prompt: string): Promise<TimelineState> {
    if (!shouldDelegatePrompt(prompt)) {
      return workspaceService.getTimelineState();
    }

    return workspaceService.dispatchVoicePrompt(prompt);
  }

  private handleNotification(payload: NotificationPayload) {
    const params = isRecord(payload.params) ? payload.params : {};
    const threadId = typeof params.threadId === "string" ? params.threadId : null;

    if (!threadId || threadId !== this.state.threadId) {
      return;
    }

    switch (payload.method) {
      case "thread/realtime/started": {
        this.state = {
          status: "live",
          threadId,
          sessionId: typeof params.sessionId === "string" ? params.sessionId : null,
          error: null
        };
        this.emitState();
        return;
      }

      case "thread/realtime/outputAudio/delta": {
        const audio = isRealtimeAudioChunk(params.audio) ? params.audio : null;

        if (!audio) {
          return;
        }

        this.emit("event", {
          type: "audio",
          audio
        } satisfies RealtimeEvent);
        return;
      }

      case "thread/realtime/itemAdded":
        this.emit("event", {
          type: "item",
          item: params.item
        } satisfies RealtimeEvent);
        return;

      case "thread/realtime/error": {
        const message =
          typeof params.message === "string" ? params.message : "Realtime transport error";

        this.state = {
          ...this.state,
          status: "error",
          error: message
        };
        this.emitState();
        this.emit("event", {
          type: "error",
          message
        } satisfies RealtimeEvent);
        return;
      }

      case "thread/realtime/closed": {
        const reason = typeof params.reason === "string" ? params.reason : null;

        this.state = {
          status: "idle",
          threadId,
          sessionId: null,
          error: reason
        };
        this.emitState();
        return;
      }

      default:
        return;
    }
  }

  private emitState() {
    this.emit("event", {
      type: "state",
      state: this.getState()
    } satisfies RealtimeEvent);
  }
}

export const realtimeService = new RealtimeService();
