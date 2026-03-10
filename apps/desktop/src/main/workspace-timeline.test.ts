import { describe, expect, it } from "vitest";
import { buildTimelineState, type TurnRecord } from "./workspace-timeline";

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

    expect(state.events).toHaveLength(48);
    expect(state.events[0]?.text).toBe("message 153");
    expect(state.events.at(-1)?.text).toBe("message 200");
  });
});
