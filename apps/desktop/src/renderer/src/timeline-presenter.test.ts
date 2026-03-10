import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "@shared";
import { presentTimelineEvent } from "./timeline-presenter";

const makeEvent = (event: Partial<TimelineEvent>): TimelineEvent => ({
  id: "event-1",
  kind: "commentary",
  text: "",
  createdAt: "Live update",
  ...event
});

describe("presentTimelineEvent", () => {
  it("keeps user prompts as full message rows", () => {
    expect(
      presentTimelineEvent(
        makeEvent({
          kind: "user",
          text: "Remove the extra label"
        })
      )
    ).toMatchObject({
      variant: "message",
      badge: "You",
      tone: "user"
    });
  });

  it("compresses assistant progress into activity rows while working", () => {
    expect(
      presentTimelineEvent(
        makeEvent({
          kind: "assistant",
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

  it("compresses explored commentary into activity rows", () => {
    expect(
      presentTimelineEvent(
        makeEvent({
          text: "Explored 3 files",
          summary: "Explored 3 files"
        })
      )
    ).toMatchObject({
      variant: "activity",
      badge: "Explore"
    });
  });

  it("compresses command events into tool activity rows", () => {
    expect(
      presentTimelineEvent(
        makeEvent({
          kind: "system",
          text: "pnpm build",
          summary: "Ran pnpm build",
          detail: "Done"
        })
      )
    ).toMatchObject({
      variant: "activity",
      badge: "Command",
      title: "Ran pnpm build"
    });
  });

  it("compresses file changes into edit activity rows with diff counts", () => {
    expect(
      presentTimelineEvent(
        makeEvent({
          kind: "system",
          text: "Edited Timeline.tsx",
          summary: "Edited Timeline.tsx",
          path: "apps/desktop/src/renderer/src/components/Timeline.tsx",
          additions: 4,
          deletions: 1
        })
      )
    ).toMatchObject({
      variant: "activity",
      badge: "Edit",
      metaLabel: "+4 -1"
    });
  });
});
