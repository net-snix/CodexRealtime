import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@shared";
import { getLatestWorkingStatus, getWorkingStatusLabel } from "./timeline-working-status";

const makeEntry = (entry: Partial<TimelineEntry>): TimelineEntry => ({
  id: "entry-1",
  kind: "activity",
  activityType: "command_execution",
  createdAt: "Live update",
  turnId: "turn-1",
  tone: "info",
  label: "",
  detail: null,
  command: null,
  changedFiles: [],
  status: null,
  toolName: null,
  agentLabel: null,
  ...entry
}) as TimelineEntry;

describe("getLatestWorkingStatus", () => {
  it("prefers the newest activity summary", () => {
    expect(
      getLatestWorkingStatus(
        [
          makeEntry({
            kind: "message",
            role: "user",
            text: "Fix the popup",
            createdAt: "Thread history"
          }),
          makeEntry({
            tone: "thinking",
            label: "Explored 3 files",
            detail: "Explored 3 files",
            createdAt: "Live update"
          }),
          makeEntry({
            label: "Edited Timeline.tsx",
            changedFiles: [
              {
                path: "apps/desktop/src/renderer/src/components/Timeline.tsx",
                additions: 1,
                deletions: 0,
                diff: null
              }
            ]
          })
        ],
        true
      )
    ).toBe("Edited Timeline.tsx");
  });

  it("returns null when there is no activity yet", () => {
    expect(
      getLatestWorkingStatus(
        [
          makeEntry({
            kind: "message",
            role: "user",
            text: "Fix the popup",
            createdAt: "Thread history"
          }),
          makeEntry({
            kind: "message",
            role: "assistant",
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
          makeEntry({
            label: "Ran pnpm build",
            command: "pnpm build",
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
