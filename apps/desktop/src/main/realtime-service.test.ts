import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineState, VoiceIntent } from "@shared";

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

    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn()
      }
    }));
    vi.doMock("./workspace-service", () => ({
      workspaceService: {
        getTimelineState,
        interruptActiveTurn,
        dispatchVoiceIntent
      }
    }));

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
    const getTimelineState = vi.fn();
    const interruptActiveTurn = vi.fn(async () => interruptedTimeline);
    const dispatchVoiceIntent = vi.fn();

    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn()
      }
    }));
    vi.doMock("./workspace-service", () => ({
      workspaceService: {
        getTimelineState,
        interruptActiveTurn,
        dispatchVoiceIntent
      }
    }));

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
    const getTimelineState = vi.fn();
    const interruptActiveTurn = vi.fn();
    const dispatchVoiceIntent = vi.fn(async () => runningTimeline);

    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn()
      }
    }));
    vi.doMock("./workspace-service", () => ({
      workspaceService: {
        getTimelineState,
        interruptActiveTurn,
        dispatchVoiceIntent
      }
    }));

    const { RealtimeService } = await import("./realtime-service");
    const service = new RealtimeService();

    await expect(service.dispatchVoiceIntent(workRequestIntent)).resolves.toEqual(runningTimeline);
    expect(dispatchVoiceIntent).toHaveBeenCalledWith(workRequestIntent);
    expect(getTimelineState).not.toHaveBeenCalled();
    expect(interruptActiveTurn).not.toHaveBeenCalled();
  });
});
