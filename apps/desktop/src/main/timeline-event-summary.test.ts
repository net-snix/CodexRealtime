import { describe, expect, it } from "vitest";
import { buildFileChangeEvents, summarizeActivityText, summarizeCommand } from "./timeline-event-summary";

describe("timeline-event-summary", () => {
  it("compresses prose into a short activity line", () => {
    expect(
      summarizeActivityText(
        "Hi Espen. Editing the two header blocks now. I'm also zeroing their title margins."
      )
    ).toBe("Editing the two header blocks now");
  });

  it("summarizes commands as compact activity labels", () => {
    expect(summarizeCommand("pnpm build")).toBe("Ran pnpm build");
  });

  it("expands file changes into per-file events with diff counts", () => {
    expect(
      buildFileChangeEvents(
        {
          id: "item-1",
          kind: "system",
          createdAt: "Thread history"
        },
        [
          {
            path: "apps/desktop/src/renderer/src/components/Timeline.tsx",
            diff: "@@\n+const x = 1;\n-const y = 2;\n"
          }
        ]
      )
    ).toMatchObject([
      {
        summary: "Edited Timeline.tsx",
        additions: 1,
        deletions: 1
      }
    ]);
  });
});
