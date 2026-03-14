import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RealtimeAudioChunk,
  RealtimeEvent,
  RealtimeTranscriptEntry,
  TimelineState,
  VoiceIntent,
  VoicePreferences
} from "@shared";

const idleTimeline: TimelineState = {
  threadId: null,
  entries: [],
  activePlan: null,
  latestProposedPlan: null,
  turnDiffs: [],
  activeDiffPreview: null,
  approvals: [],
  userInputs: [],
  isRunning: false,
  runState: {
    phase: "idle",
    label: null
  },
  activeWorkStartedAt: null,
  latestTurn: null
};

const workRequestIntent: VoiceIntent = {
  kind: "work_request",
  source: {
    sourceType: "handoff_request",
    itemId: "item-1",
    handoffId: "handoff-1",
    transcript: "Inspect the auth tests",
    metadata: {
      rawType: "handoff_request"
    }
  },
  taskEnvelope: {
    workspaceId: "workspace-1",
    threadId: "thread-1",
    source: "handoff_request",
    sourceItemId: "item-1",
    transcript: "Inspect the auth tests",
    userGoal: "Inspect the auth tests",
    distilledPrompt: "Inspect the auth tests, explain the root cause, and propose a fix.",
    constraints: ["Ask before changing public APIs"],
    acceptanceCriteria: ["Explain the root cause"],
    clarificationPolicy: "request_user_input",
    replyStyle: "concise milestones + clear final summary",
    sourceMessageIds: ["item-1"],
    rawPayload: {
      rawType: "handoff_request"
    },
    handoffId: "handoff-1"
  }
};

const realtimePreferences: VoicePreferences = {
  mode: "realtime",
  speakAgentActivity: true,
  speakToolCalls: true,
  speakPlanUpdates: true,
  selectedInputDeviceId: "",
  selectedOutputDeviceId: "",
  deviceHintDismissed: false,
  deviceSetupComplete: false
};

const transcriptionPreferences: VoicePreferences = {
  ...realtimePreferences,
  mode: "transcription"
};

type RealtimeEngineListeners = {
  audio?: (audio: RealtimeAudioChunk) => void;
  transcript?: (entry: RealtimeTranscriptEntry) => void;
  error?: (message: string) => void;
  closed?: (reason: string | null) => void;
};

const setupMocks = ({
  preferences = realtimePreferences,
  getCurrentThreadId = vi.fn(async () => "thread-1"),
  getTimelineState = vi.fn(async () => ({ ...idleTimeline, threadId: "thread-1" })),
  interruptActiveTurn = vi.fn(async () => ({
    ...idleTimeline,
    runState: {
      phase: "interrupted" as const,
      label: "Interrupted"
    }
  })),
  dispatchVoiceIntent = vi.fn(async () => ({
    ...idleTimeline,
    threadId: "thread-1",
    isRunning: true,
    runState: {
      phase: "running" as const,
      label: "Working"
    }
  })),
  transcribeWavAudio = vi.fn(async () => "Inspect src/App.tsx and fix the failing test"),
  synthesizeSpeech = vi.fn(),
  engineStart = vi.fn(async () => "rt-session-1"),
  engineCompleteTurnAndStop = vi.fn(async () => undefined),
  engineStop = vi.fn(async () => undefined),
  engineAppendAudio = vi.fn(async () => undefined),
  engineAppendText = vi.fn(async () => undefined),
  engineDispose = vi.fn(async () => undefined)
}: {
  preferences?: VoicePreferences;
  getCurrentThreadId?: ReturnType<typeof vi.fn<() => Promise<string>>>;
  getTimelineState?: ReturnType<typeof vi.fn<() => Promise<TimelineState>>>;
  interruptActiveTurn?: ReturnType<typeof vi.fn<() => Promise<TimelineState>>>;
  dispatchVoiceIntent?: ReturnType<typeof vi.fn<(intent: VoiceIntent) => Promise<TimelineState>>>;
  transcribeWavAudio?: ReturnType<typeof vi.fn<(audio: Uint8Array) => Promise<string>>>;
  synthesizeSpeech?: ReturnType<typeof vi.fn>;
  engineStart?: ReturnType<typeof vi.fn<(instructions: string) => Promise<string | null>>>;
  engineCompleteTurnAndStop?: ReturnType<typeof vi.fn<() => Promise<void>>>;
  engineStop?: ReturnType<typeof vi.fn<() => Promise<void>>>;
  engineAppendAudio?: ReturnType<typeof vi.fn<(audio: RealtimeAudioChunk) => Promise<void>>>;
  engineAppendText?: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
  engineDispose?: ReturnType<typeof vi.fn<() => Promise<void>>>;
} = {}) => {
  const engineListeners: RealtimeEngineListeners = {};

  vi.doMock("./openai-realtime-engine", () => ({
    openAiRealtimeEngine: {
      on: vi.fn((event: keyof RealtimeEngineListeners, listener: never) => {
        engineListeners[event] = listener;
      }),
      start: engineStart,
      completeTurnAndStop: engineCompleteTurnAndStop,
      stop: engineStop,
      appendAudio: engineAppendAudio,
      appendText: engineAppendText,
      dispose: engineDispose
    }
  }));
  vi.doMock("./workspace-service", () => ({
    workspaceService: {
      on: vi.fn(),
      getCurrentThreadId,
      getTimelineState,
      interruptActiveTurn,
      dispatchVoiceIntent
    }
  }));
  vi.doMock("./voice-preferences-service", () => ({
    voicePreferencesService: {
      getPreferences: vi.fn(() => preferences)
    }
  }));
  vi.doMock("./openai-voice-client", () => ({
    openAiVoiceClient: {
      transcribeWavAudio,
      synthesizeSpeech
    }
  }));

  return {
    engineListeners,
    engineStart,
    engineCompleteTurnAndStop,
    engineStop,
    engineAppendAudio,
    engineAppendText,
    engineDispose,
    getCurrentThreadId,
    getTimelineState,
    interruptActiveTurn,
    dispatchVoiceIntent,
    transcribeWavAudio,
    synthesizeSpeech
  };
};

describe("RealtimeService", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns timeline state for conversational voice intents", async () => {
    const getTimelineState = vi.fn(async () => idleTimeline);
    const interruptActiveTurn = vi.fn();
    const dispatchVoiceIntent = vi.fn();
    setupMocks({
      getTimelineState,
      interruptActiveTurn,
      dispatchVoiceIntent
    });

    const { RealtimeService } = await import("./realtime-service");
    const service = new RealtimeService();
    const conversationIntent: VoiceIntent = {
      kind: "conversation",
      source: workRequestIntent.source
    };

    await expect(service.dispatchVoiceIntent(conversationIntent)).resolves.toEqual(idleTimeline);
    expect(getTimelineState).toHaveBeenCalledTimes(1);
    expect(interruptActiveTurn).not.toHaveBeenCalled();
    expect(dispatchVoiceIntent).not.toHaveBeenCalled();
  });

  it("interrupts active work for interrupt requests", async () => {
    const interruptedTimeline: TimelineState = {
      ...idleTimeline,
      runState: {
        phase: "interrupted",
        label: "Interrupted"
      }
    };
    const interruptActiveTurn = vi.fn(async () => interruptedTimeline);
    const getTimelineState = vi.fn();
    const dispatchVoiceIntent = vi.fn();
    setupMocks({
      getTimelineState,
      interruptActiveTurn,
      dispatchVoiceIntent
    });

    const { RealtimeService } = await import("./realtime-service");
    const service = new RealtimeService();
    const interruptIntent: VoiceIntent = {
      kind: "interrupt_request",
      source: workRequestIntent.source,
      reason: "stop"
    };

    await expect(service.dispatchVoiceIntent(interruptIntent)).resolves.toEqual(interruptedTimeline);
    expect(interruptActiveTurn).toHaveBeenCalledTimes(1);
    expect(getTimelineState).not.toHaveBeenCalled();
    expect(dispatchVoiceIntent).not.toHaveBeenCalled();
  });

  it("delegates work requests to the workspace service", async () => {
    const runningTimeline: TimelineState = {
      ...idleTimeline,
      isRunning: true,
      runState: {
        phase: "running",
        label: "Working"
      }
    };
    const dispatchVoiceIntent = vi.fn(async () => runningTimeline);
    const getTimelineState = vi.fn();
    const interruptActiveTurn = vi.fn();
    setupMocks({
      getTimelineState,
      interruptActiveTurn,
      dispatchVoiceIntent
    });

    const { RealtimeService } = await import("./realtime-service");
    const service = new RealtimeService();

    await expect(service.dispatchVoiceIntent(workRequestIntent)).resolves.toEqual(runningTimeline);
    expect(dispatchVoiceIntent).toHaveBeenCalledWith(workRequestIntent);
    expect(getTimelineState).not.toHaveBeenCalled();
    expect(interruptActiveTurn).not.toHaveBeenCalled();
  });

  it("transcribes buffered audio and emits a handled transcript in transcription mode", async () => {
    const transcribeWavAudio = vi.fn(async () => "Inspect src/App.tsx and fix the failing test");
    const getCurrentThreadId = vi.fn(async () => "thread-voice");
    const getTimelineState = vi.fn(async () => ({
      ...idleTimeline,
      threadId: "thread-voice"
    }));
    const dispatchVoiceIntent = vi.fn(async () => ({
      ...idleTimeline,
      threadId: "thread-voice",
      isRunning: true,
      runState: {
        phase: "running" as const,
        label: "Working"
      }
    }));

    setupMocks({
      preferences: transcriptionPreferences,
      transcribeWavAudio,
      getCurrentThreadId,
      getTimelineState,
      dispatchVoiceIntent
    });

    const { RealtimeService } = await import("./realtime-service");
    const service = new RealtimeService();
    const events: RealtimeEvent[] = [];
    service.on("event", (event) => {
      events.push(event);
    });

    await expect(service.start()).resolves.toMatchObject({
      status: "live",
      threadId: "thread-voice"
    });

    await service.appendAudio({
      data: Buffer.from(new Uint8Array([0, 1, 2, 3])).toString("base64"),
      sampleRate: 24_000,
      numChannels: 1,
      samplesPerChannel: 2
    });

    await expect(service.stop()).resolves.toMatchObject({
      status: "idle",
      threadId: "thread-voice"
    });

    expect(transcribeWavAudio).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "transcript",
        intentHandled: true,
        entry: expect.objectContaining({
          speaker: "user",
          text: "Inspect src/App.tsx and fix the failing test"
        })
      })
    );
    expect(dispatchVoiceIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "work_request"
      })
    );
  });

  it("starts realtime mode through the OpenAI engine and handles final user transcripts in main", async () => {
    const {
      engineListeners,
      engineStart,
      engineAppendAudio,
      engineCompleteTurnAndStop,
      dispatchVoiceIntent
    } =
      setupMocks();

    const { RealtimeService } = await import("./realtime-service");
    const service = new RealtimeService();
    const events: RealtimeEvent[] = [];
    service.on("event", (event) => {
      events.push(event);
    });

    await expect(service.start()).resolves.toMatchObject({
      status: "live",
      threadId: "thread-1",
      sessionId: "rt-session-1"
    });

    expect(engineStart).toHaveBeenCalledTimes(1);

    await service.appendAudio({
      data: Buffer.from(new Uint8Array([0, 1, 2, 3])).toString("base64"),
      sampleRate: 48_000,
      numChannels: 2,
      samplesPerChannel: 1
    });
    expect(engineAppendAudio).toHaveBeenCalledTimes(1);

    engineListeners.audio?.({
      data: Buffer.from(new Uint8Array([0, 1])).toString("base64"),
      sampleRate: 24_000,
      numChannels: 1,
      samplesPerChannel: 1
    });
    engineListeners.transcript?.({
      id: "assistant-1",
      speaker: "assistant",
      text: "Handing this to Codex now.",
      status: "final",
      createdAt: "2026-03-14T12:00:00.000Z"
    });
    engineListeners.transcript?.({
      id: "user-1",
      speaker: "user",
      text: "Inspect src/App.tsx and fix the failing test",
      status: "final",
      createdAt: "2026-03-14T12:00:01.000Z"
    });

    await vi.waitFor(() => {
      expect(dispatchVoiceIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "work_request"
        })
      );
    });
    await vi.waitFor(() => {
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "transcript",
          intentHandled: true,
          entry: expect.objectContaining({
            id: "user-1",
            speaker: "user"
          })
        })
      );
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "audio"
      })
    );

    await expect(service.stop()).resolves.toMatchObject({
      status: "idle",
      threadId: "thread-1"
    });
    expect(engineCompleteTurnAndStop).toHaveBeenCalledTimes(1);
  });

  it("surfaces realtime engine errors on the active voice session", async () => {
    const { engineListeners } = setupMocks();

    const { RealtimeService } = await import("./realtime-service");
    const service = new RealtimeService();
    const events: RealtimeEvent[] = [];
    service.on("event", (event) => {
      events.push(event);
    });

    await service.start();

    engineListeners.error?.("Realtime voice websocket failed.");

    expect(events).toContainEqual({
      type: "error",
      message: "Realtime voice websocket failed."
    });
    expect(service.getState()).toMatchObject({
      status: "error",
      error: "Realtime voice websocket failed."
    });
  });
});
