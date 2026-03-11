import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "@shared";
import { getLatestWorkingStatus, getWorkingStatusLabel } from "./timeline-working-status";

const makeEvent = (event: Partial<TimelineEvent>): TimelineEvent => ({
  id: "event-1",
  kind: "commentary",
  text: "",
  createdAt: "Live update",
  ...event
});

describe("getLatestWorkingStatus", () => {
  it("prefers the newest activity summary", () => {
    expect(
      getLatestWorkingStatus(
        [
          makeEvent({ kind: "user", text: "Fix the popup", createdAt: "Thread history" }),
          makeEvent({
            kind: "commentary",
            text: "Explored 3 files",
            summary: "Explored 3 files",
            createdAt: "Live update"
          }),
          makeEvent({ kind: "system", text: "Edited Timeline.tsx", summary: "Edited Timeline.tsx" })
        ],
        true
      )
    ).toBe("Edited Timeline.tsx");
  });

  it("returns null when there is no activity yet", () => {
    expect(
      getLatestWorkingStatus(
        [
          makeEvent({ kind: "user", text: "Fix the popup", createdAt: "Thread history" }),
          makeEvent({
            kind: "assistant",
            text: "Old summary",
            summary: "Old summary",
            createdAt: "Thread history"
          })
        ],
        true
      )
    ).toBe(null);
  });

  it("maps command activity to a running label", () => {
    expect(
      getWorkingStatusLabel(
        [
          makeEvent({
            kind: "system",
            text: "Ran pnpm build",
            summary: "Ran pnpm build",
            detail: "Done",
            createdAt: "Live update"
          })
        ],
        true,
        "Thinking.",
        false
      )
    ).toBe("Running");
  });

  it("falls back to the animated thinking label", () => {
    expect(getWorkingStatusLabel([], true, "Thinking..", false)).toBe("Thinking..");
  });

  it("prefers waiting while requests are unresolved", () => {
    expect(getWorkingStatusLabel([], true, "Thinking", true)).toBe("Waiting");
  });
});
