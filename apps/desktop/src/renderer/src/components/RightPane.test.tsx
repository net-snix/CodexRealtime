// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineState } from "@shared";
import { RightPane } from "./RightPane";

const timelineState: TimelineState = {
  threadId: "thread-1",
  entries: [],
  activePlan: null,
  latestProposedPlan: null,
  turnDiffs: [
    {
      id: "diff-1",
      kind: "diffSummary",
      createdAt: "10:00",
      turnId: "turn-1",
      assistantMessageId: null,
      title: "Refactor app shell",
      diff: "diff --git a/src/app.tsx b/src/app.tsx\n@@ -1 +1 @@\n-old shell\n+new shell",
      files: [
        {
          path: "src/app.tsx",
          additions: 1,
          deletions: 1,
          diff: "@@ -1 +1 @@\n-old shell\n+new shell"
        }
      ],
      additions: 1,
      deletions: 1
    },
    {
      id: "diff-2",
      kind: "diffSummary",
      createdAt: "10:05",
      turnId: "turn-2",
      assistantMessageId: null,
      title: "Refactor worker",
      diff:
        "diff --git a/src/worker.ts b/src/worker.ts\n@@ -3 +3 @@\n-old worker\n+new worker\n\n" +
        "diff --git a/src/view.tsx b/src/view.tsx\n@@ -7 +7 @@\n-old view\n+new view",
      files: [
        {
          path: "src/worker.ts",
          additions: 1,
          deletions: 1,
          diff: "@@ -3 +3 @@\n-old worker\n+new worker"
        },
        {
          path: "src/view.tsx",
          additions: 1,
          deletions: 1,
          diff: "@@ -7 +7 @@\n-old view\n+new view"
        }
      ],
      additions: 2,
      deletions: 2
    }
  ],
  activeDiffPreview: {
    id: "diff-2",
    kind: "diffSummary",
    createdAt: "10:05",
    turnId: "turn-2",
    assistantMessageId: null,
    title: "Refactor worker",
    diff:
      "diff --git a/src/worker.ts b/src/worker.ts\n@@ -3 +3 @@\n-old worker\n+new worker\n\n" +
      "diff --git a/src/view.tsx b/src/view.tsx\n@@ -7 +7 @@\n-old view\n+new view",
    files: [
      {
        path: "src/worker.ts",
        additions: 1,
        deletions: 1,
        diff: "@@ -3 +3 @@\n-old worker\n+new worker"
      },
      {
        path: "src/view.tsx",
        additions: 1,
        deletions: 1,
        diff: "@@ -7 +7 @@\n-old view\n+new view"
      }
    ],
    additions: 2,
    deletions: 2
  },
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

describe("RightPane", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("renders a real diff browser with aggregate and per-revision scopes", async () => {
    await act(async () => {
      root?.render(
        <RightPane
          activePane="diff"
          onSelect={vi.fn()}
          onClose={vi.fn()}
          timelineState={timelineState}
        />
      );
    });

    const allChangesChip = Array.from(container?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("All changes")
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      allChangesChip?.click();
    });

    expect(container?.textContent).toContain("All changes");
    expect(container?.textContent).toContain("Refactor worker");
    expect(container?.textContent).toContain("src/app.tsx");
    expect(container?.textContent).toContain("src/worker.ts");
    expect(container?.textContent).toContain("src/view.tsx");
  });

  it("keeps rendering the active live diff preview when it is not yet in history", async () => {
    await act(async () => {
      root?.render(
        <RightPane
          activePane="diff"
          onSelect={vi.fn()}
          onClose={vi.fn()}
          timelineState={{
            ...timelineState,
            activeDiffPreview: {
              id: "live-diff-thread-1",
              kind: "diffSummary",
              createdAt: "Live update",
              turnId: "turn-3",
              assistantMessageId: null,
              title: "Live diff preview",
              diff: "diff --git a/src/live.ts b/src/live.ts\n@@ -2 +2 @@\n-old live\n+new live",
              files: [
                {
                  path: "src/live.ts",
                  additions: 1,
                  deletions: 1,
                  diff: "@@ -2 +2 @@\n-old live\n+new live"
                }
              ],
              additions: 1,
              deletions: 1
            }
          }}
        />
      );
    });

    expect(container?.textContent).toContain("Live diff preview");
    expect(container?.textContent).toContain("src/live.ts");
    expect(container?.textContent).toContain("All changes");
  });

  it("switches between revision chips, file rows, and patch view", async () => {
    await act(async () => {
      root?.render(
        <RightPane
          activePane="diff"
          onSelect={vi.fn()}
          onClose={vi.fn()}
          timelineState={timelineState}
        />
      );
    });

    const diffChip = Array.from(container?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("Refactor worker")
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      diffChip?.click();
    });

    const fileButton = Array.from(container?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("src/view.tsx")
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      fileButton?.click();
    });

    expect(container?.textContent).toContain("src/view.tsx");
    expect(container?.textContent).toContain("+1 -1");

    const patchButton = Array.from(container?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent === "Patch"
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      patchButton?.click();
    });

    expect(container?.textContent).toContain("diff --git a/src/worker.ts b/src/worker.ts");
  });

  it("copies the visible file patch in files mode", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    await act(async () => {
      root?.render(
        <RightPane
          activePane="diff"
          onSelect={vi.fn()}
          onClose={vi.fn()}
          timelineState={timelineState}
        />
      );
    });

    const fileButton = Array.from(container?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("src/view.tsx")
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      fileButton?.click();
    });

    const actionButton = container?.querySelector(
      'button[aria-label="Diff actions"]'
    ) as HTMLButtonElement | null;

    await act(async () => {
      actionButton?.click();
    });

    const copyButton = Array.from(container?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent === "Copy diff"
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      copyButton?.click();
    });

    expect(writeText).toHaveBeenCalledWith("@@ -7 +7 @@\n-old view\n+new view");
  });
});
