import { EventEmitter } from "node:events";
import { createVoiceIntentFromTranscript } from "@shared/voice-intents";
import type {
  RealtimeAudioChunk,
  RealtimeEvent,
  RealtimeState,
  RealtimeTranscriptEntry,
  TimelineState,
  VoiceIntent
} from "@shared";
import { openAiRealtimeEngine } from "./openai-realtime-engine";
import { openAiVoiceClient } from "./openai-voice-client";
import { createWavFileFromAudioChunks } from "./voice-audio";
import { createVoiceNarrationCue } from "./voice-narration";
import { voicePreferencesService } from "./voice-preferences-service";
import { workspaceService } from "./workspace-service";

const DEFAULT_REALTIME_PROMPT =
  "You are a voice-native software engineering assistant. Keep replies concise, useful, and grounded in the current repo thread.";

const cloneRealtimeState = (state: RealtimeState): RealtimeState => ({ ...state });
const makeSessionId = (mode: "realtime" | "transcription") =>
  `${mode}:${Date.now().toString(36)}`;

type VoiceSession = {
  mode: "realtime" | "transcription";
  threadId: string;
  audioChunks: RealtimeAudioChunk[];
  lastTimeline: TimelineState | null;
  lastCueKey: string | null;
};

export class RealtimeService extends EventEmitter {
  private state: RealtimeState = {
    status: "idle",
    threadId: null,
    sessionId: null,
    error: null
  };
  private activeMode: "realtime" | "transcription" | null = null;
  private voiceSession: VoiceSession | null = null;
  private narrationQueue = Promise.resolve();

  constructor() {
    super();

    openAiRealtimeEngine.on("audio", (audio) => {
      this.emit("event", {
        type: "audio",
        audio
      } satisfies RealtimeEvent);
    });
    openAiRealtimeEngine.on("transcript", (entry) => {
      void this.handleRealtimeTranscript(entry).catch((error) => {
        this.emitRealtimeError(
          error instanceof Error ? error.message : "Realtime transcript handling failed"
        );
      });
    });
    openAiRealtimeEngine.on("error", (message) => {
      this.emitRealtimeError(message);
    });
    openAiRealtimeEngine.on("closed", (reason) => {
      if (reason) {
        this.emitRealtimeError(reason);
        return;
      }

      if (this.activeMode !== "realtime" && this.state.status === "idle") {
        return;
      }

      this.activeMode = null;
      this.clearRealtimeDispatchState();
      this.state = {
        status: "idle",
        threadId: this.state.threadId,
        sessionId: null,
        error: null
      };
      this.emitState();
    });
    workspaceService.on("timeline", (timeline: TimelineState) => {
      void this.handleTimelineUpdate(timeline);
    });
  }

  getState() {
    return cloneRealtimeState(this.state);
  }

  async start(prompt = DEFAULT_REALTIME_PROMPT) {
    const preferences = voicePreferencesService.getPreferences();
    this.clearRealtimeDispatchState();

    if (preferences.mode === "transcription") {
      return this.startTranscriptionSession();
    }

    const threadId = await workspaceService.getCurrentThreadId();
    const baselineTimeline = await workspaceService.getTimelineState();
    this.activeMode = "realtime";
    this.voiceSession = {
      mode: "realtime",
      threadId,
      audioChunks: [],
      lastTimeline: baselineTimeline.threadId === threadId ? baselineTimeline : null,
      lastCueKey: null
    };

    this.state = {
      status: "connecting",
      threadId,
      sessionId: null,
      error: null
    };
    this.emitState();

    try {
      const sessionId = await openAiRealtimeEngine.start(prompt);
      this.state = {
        status: "live",
        threadId,
        sessionId,
        error: null
      };
      this.emitState();
      return this.getState();
    } catch (error) {
      this.activeMode = null;
      this.voiceSession = null;
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
      await openAiRealtimeEngine.dispose();
      this.voiceSession = null;
      this.clearRealtimeDispatchState();
      return this.getState();
    }

    if (this.activeMode === "transcription") {
      return this.stopTranscriptionSession();
    }

    const threadId = this.state.threadId;
    this.state = {
      ...this.state,
      status: "connecting",
      error: null
    };
    this.emitState();

    try {
      await openAiRealtimeEngine.completeTurnAndStop();
    } finally {
      this.activeMode = null;
      this.clearRealtimeDispatchState();
      this.state = {
        status: "idle",
        threadId,
        sessionId: null,
        error: null
      };
      this.emitState();
    }

    return this.getState();
  }

  async appendAudio(audio: RealtimeAudioChunk) {
    if (!this.state.threadId || this.state.status !== "live") {
      throw new Error("Realtime is not started.");
    }

    if (this.activeMode === "transcription") {
      this.voiceSession?.audioChunks.push(audio);
      return;
    }

    await openAiRealtimeEngine.appendAudio(audio);
  }

  async appendText(text: string) {
    if (!this.state.threadId) {
      throw new Error("Realtime is not started.");
    }

    if (this.activeMode === "transcription") {
      const transcript = text.trim();

      if (!transcript) {
        return;
      }

      const parsedTranscript = createVoiceIntentFromTranscript({
        transcript,
        id: `transcript:${Date.now().toString(36)}`
      });

      if (!parsedTranscript) {
        return;
      }

      this.emitTranscript(parsedTranscript.transcriptEntry, true);
      await this.dispatchParsedTranscriptIntent(parsedTranscript.intent);
      return;
    }

    await openAiRealtimeEngine.appendText(text);
  }

  async dispatchVoiceIntent(intent: VoiceIntent): Promise<TimelineState> {
    if (intent.kind === "conversation") {
      return workspaceService.getTimelineState();
    }

    if (intent.kind === "interrupt_request") {
      return workspaceService.interruptActiveTurn();
    }

    return workspaceService.dispatchVoiceIntent(intent);
  }

  private async startTranscriptionSession() {
    const threadId = await workspaceService.getCurrentThreadId();
    const baselineTimeline = await workspaceService.getTimelineState();
    this.activeMode = "transcription";
    this.voiceSession = {
      mode: "transcription",
      threadId,
      audioChunks: [],
      lastTimeline: baselineTimeline.threadId === threadId ? baselineTimeline : null,
      lastCueKey: null
    };
    this.state = {
      status: "live",
      threadId,
      sessionId: makeSessionId("transcription"),
      error: null
    };
    this.emitState();
    return this.getState();
  }

  private async stopTranscriptionSession() {
    const session =
      this.voiceSession?.mode === "transcription" ? this.voiceSession : null;
    const threadId = this.state.threadId;

    if (!session || !threadId) {
      this.activeMode = null;
      this.voiceSession = null;
      this.clearRealtimeDispatchState();
      this.state = {
        status: "idle",
        threadId: null,
        sessionId: null,
        error: null
      };
      this.emitState();
      return this.getState();
    }

    const audioChunks = session.audioChunks.slice();
    session.audioChunks = [];

    if (audioChunks.length === 0) {
      this.activeMode = null;
      this.voiceSession = null;
      this.clearRealtimeDispatchState();
      this.state = {
        status: "idle",
        threadId,
        sessionId: null,
        error: null
      };
      this.emitState();
      return this.getState();
    }

    this.state = {
      ...this.state,
      status: "connecting",
      error: null
    };
    this.emitState();

    try {
      const transcript = await openAiVoiceClient.transcribeWavAudio(
        createWavFileFromAudioChunks(audioChunks)
      );
      const parsedTranscript = createVoiceIntentFromTranscript({
        transcript,
        id: `transcript:${Date.now().toString(36)}`
      });

      if (!parsedTranscript) {
        throw new Error("Transcription returned no text.");
      }

      this.emitTranscript(parsedTranscript.transcriptEntry, true);
      await this.dispatchParsedTranscriptIntent(parsedTranscript.intent);

      this.activeMode = null;
      this.state = {
        status: "idle",
        threadId,
        sessionId: null,
        error: null
      };
      this.emitState();
      return this.getState();
    } catch (error) {
      this.activeMode = null;
      this.voiceSession = null;
      this.clearRealtimeDispatchState();
      this.state = {
        status: "error",
        threadId,
        sessionId: null,
        error: error instanceof Error ? error.message : "Voice transcription failed"
      };
      this.emitState();
      throw error;
    }
  }

  private emitRealtimeError(message: string) {
    this.activeMode = null;
    this.voiceSession = null;
    this.clearRealtimeDispatchState();
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
  }

  private clearRealtimeDispatchState() {
    // Canonical OpenAI voice path dispatches final intents immediately in main.
  }

  private async executeVoiceIntentDispatch(intent: VoiceIntent) {
    try {
      await this.dispatchVoiceIntent(intent);
    } catch (error) {
      this.emitRealtimeError(
        error instanceof Error ? error.message : "Voice intent dispatch failed"
      );
      throw error;
    }
  }

  private emitState() {
    this.emit("event", {
      type: "state",
      state: this.getState()
    } satisfies RealtimeEvent);
  }

  private emitTranscript(entry: RealtimeTranscriptEntry, intentHandled: boolean) {
    this.emit("event", {
      type: "transcript",
      entry,
      intentHandled
    } satisfies RealtimeEvent);
  }

  private async dispatchParsedTranscriptIntent(intent: VoiceIntent | null) {
    if (!intent) {
      return;
    }

    await this.executeVoiceIntentDispatch(intent);
  }

  private async handleRealtimeTranscript(entry: RealtimeTranscriptEntry) {
    let intentHandled = false;

    if (
      this.activeMode === "realtime" &&
      entry.speaker === "user" &&
      entry.status === "final"
    ) {
      const parsedTranscript = createVoiceIntentFromTranscript({
        transcript: entry.text,
        id: entry.id,
        createdAt: entry.createdAt
      });

      if (parsedTranscript?.intent) {
        await this.dispatchParsedTranscriptIntent(parsedTranscript.intent);
        intentHandled = true;
      }
    }

    this.emitTranscript(entry, intentHandled);
  }

  private async handleTimelineUpdate(timeline: TimelineState) {
    const session = this.voiceSession;

    if (!session || timeline.threadId !== session.threadId) {
      return;
    }

    const preferences = voicePreferencesService.getPreferences();
    const cue = createVoiceNarrationCue({
      previousTimeline: session.lastTimeline,
      nextTimeline: timeline,
      preferences
    });
    session.lastTimeline = timeline;

    if (!cue || cue.key === session.lastCueKey) {
      return;
    }

    session.lastCueKey = cue.key;
    this.narrationQueue = this.narrationQueue
      .catch(() => undefined)
      .then(async () => {
        const audio = await openAiVoiceClient.synthesizeSpeech(cue.text);
        this.emit("event", {
          type: "audio",
          audio
        } satisfies RealtimeEvent);
      })
      .catch((error) => {
        this.emitRealtimeError(
          error instanceof Error ? error.message : "Voice narration failed"
        );
      });

    if (cue.terminal && this.activeMode === null) {
      this.voiceSession = null;
    }
  }
}

export const realtimeService = new RealtimeService();
