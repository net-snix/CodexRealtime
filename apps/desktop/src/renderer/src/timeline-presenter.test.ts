import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@shared";
import { presentTimelineEvent } from "./timeline-presenter";

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

describe("presentTimelineEvent", () => {
  it("keeps user prompts as full message rows", () => {
    expect(
      presentTimelineEvent(
        makeEntry({
          kind: "message",
          role: "user",
          text: "Remove the extra label"
        })
      )
    ).toMatchObject({
      variant: "message",
      badge: null,
      tone: "user"
    });
  });

  it("compresses assistant progress into activity rows while working", () => {
    expect(
      presentTimelineEvent(
        makeEntry({
          kind: "message",
          role: "assistant",
          text: "Hi Espen. The generator is running. Once it lands, I'll grep the real turn params.",
          summary: "The generator is running"
        }),
        true
      )
    ).toMatchObject({
      variant: "activity",
      title: "The generator is running"
    });
  });

  it("does not show a Codex badge on assistant replies", () => {
    expect(
      presentTimelineEvent(
        makeEntry({
          kind: "message",
          role: "assistant",
          text: "Archive smoke path looks healthy."
        })
      )
    ).toMatchObject({
      variant: "message",
      badge: null,
      tone: "assistant"
    });
  });

  it("renders reasoning entries as compact activity rows", () => {
    expect(
      presentTimelineEvent(
        makeEntry({
          activityType: "reasoning",
          tone: "thinking",
          label: "Explored 3 files",
          detail: "Explored 3 files"
        })
      )
    ).toMatchObject({
      variant: "activity",
      badge: "Think"
    });
  });

  it("compresses command events into tool activity rows", () => {
    expect(
      presentTimelineEvent(
        makeEntry({
          label: "Ran pnpm build",
          command: "pnpm build",
          detail: "Done"
        })
      )
    ).toMatchObject({
      variant: "activity",
      badge: "Command",
      title: "Ran pnpm build"
    });
  });

  it("shows changed-file metadata on activity rows", () => {
    expect(
      presentTimelineEvent(
        makeEntry({
          activityType: "unknown",
          label: "Edited Timeline.tsx",
          changedFiles: [
            {
              path: "apps/desktop/src/renderer/src/components/Timeline.tsx",
              additions: 4,
              deletions: 1,
              diff: null
            }
          ]
        })
      )
    ).toMatchObject({
      variant: "activity",
      badge: "Work",
      metaLabel: "+4 -1"
    });
  });
});
