import { describe, expect, it } from "vitest";
import type { TimelineState } from "@shared";
import {
  applyOptimisticTurnStart,
  createOptimisticUserEventId,
  removeOptimisticTurnStart
} from "./timeline-state-transitions";

const baseTimelineState: TimelineState = {
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
    label: "Idle"
  }
};

describe("timeline turn transitions", () => {
  it("adds the pending user prompt immediately", () => {
    const eventId = createOptimisticUserEventId();
    const nextState = applyOptimisticTurnStart(baseTimelineState, "Ship the fix", eventId);

    expect(nextState.isRunning).toBe(true);
    expect(nextState.runState.label).toBe("Starting");
    expect(nextState.entries).toHaveLength(1);
    expect(nextState.entries[0]).toMatchObject({
      id: eventId,
      kind: "message",
      role: "user",
      text: "Ship the fix"
    });
  });

  it("removes the optimistic event when the turn fails", () => {
    const eventId = createOptimisticUserEventId();
    const optimisticState = applyOptimisticTurnStart(baseTimelineState, "Ship the fix", eventId);
    const revertedState = removeOptimisticTurnStart(optimisticState, eventId);

    expect(revertedState.entries).toHaveLength(0);
  });
});
