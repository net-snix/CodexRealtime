import { describe, expect, it } from "vitest";
import type { TimelineState, VoicePreferences } from "@shared";
import { createVoiceNarrationCue } from "./voice-narration";

const preferences: VoicePreferences = {
  mode: "transcription",
  speakAgentActivity: true,
  speakToolCalls: true,
  speakPlanUpdates: true,
  selectedInputDeviceId: "",
  selectedOutputDeviceId: "",
  deviceHintDismissed: false,
  deviceSetupComplete: false
};

const idleTimeline: TimelineState = {
  threadId: "thread-1",
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

describe("voice-narration", () => {
  it("speaks command activity when tool-call narration is enabled", () => {
    const cue = createVoiceNarrationCue({
      previousTimeline: idleTimeline,
      nextTimeline: {
        ...idleTimeline,
        entries: [
          {
            id: "activity-1",
            kind: "activity",
            activityType: "command_execution",
            createdAt: "2026-03-14T12:00:00.000Z",
            turnId: "turn-1",
            tone: "tool",
            label: "Command",
            detail: "Running pnpm test",
            command: "pnpm test",
            changedFiles: [],
            status: "in_progress",
            toolName: null,
            agentLabel: null
          }
        ]
      },
      preferences
    });

    expect(cue).toEqual({
      key: "entry:activity-1",
      text: "Running pnpm test",
      terminal: false
    });
  });
});
