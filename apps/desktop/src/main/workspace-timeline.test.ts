import { describe, expect, it } from "vitest";
import {
  appendOptimisticUserEvent,
  applyBridgeNotification,
  buildTimelineState,
  emptyTimelineState,
  type TurnRecord
} from "./workspace-timeline";

const makeTurn = (index: number): TurnRecord => ({
  id: `turn-${index}`,
  status: "completed",
  items: [
    {
      type: "agentMessage",
      id: `item-${index}`,
      text: `message ${index}`
    }
  ]
});

describe("buildTimelineState", () => {
  it("keeps only the newest timeline events", () => {
    const turns = Array.from({ length: 200 }, (_, index) => makeTurn(index + 1));
    const state = buildTimelineState("thread-1", turns);

    expect(state.entries).toHaveLength(48);
    expect(state.entries[0]).toMatchObject({
      kind: "message",
      text: "message 153"
    });
    expect(state.entries.at(-1)).toMatchObject({
      kind: "message",
      text: "message 200"
    });
  });
});

describe("appendOptimisticUserEvent", () => {
  it("adds the prompt to the live timeline immediately", () => {
    const state = appendOptimisticUserEvent(emptyTimelineState("thread-1"), "Ship the fix");

    expect(state.isRunning).toBe(true);
    expect(state.runState.label).toBe("Starting");
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({
      kind: "message",
      role: "user",
      text: "Ship the fix"
    });
  });

  it("replaces the optimistic prompt when the real user item arrives", async () => {
    const optimistic = appendOptimisticUserEvent(emptyTimelineState("thread-1"), "Ship the fix");
    const resolved = await applyBridgeNotification(
      optimistic,
      {
        method: "item/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            type: "userMessage",
            id: "user-item-1",
            content: [{ type: "text", text: "Ship the fix" }]
          }
        }
      },
      (threadId) => threadId === "thread-1",
      async () => optimistic
    );

    expect(resolved.entries).toHaveLength(1);
    expect(resolved.entries[0]).toMatchObject({
      id: "user-item-1",
      kind: "message",
      role: "user",
      text: "Ship the fix"
    });
  });
});
