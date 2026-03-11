import { describe, expect, it } from "vitest";
import type { TimelineDiffEntry } from "@shared";
import { buildAggregateDiffEntry, parseDiffViewerLines } from "./right-pane-diff";

const createDiffEntry = (overrides: Partial<TimelineDiffEntry> = {}): TimelineDiffEntry => ({
  id: "diff-1",
  kind: "diffSummary",
  createdAt: "10:00",
  turnId: "turn-1",
  assistantMessageId: null,
  title: "Updated src/app.tsx",
  diff: "diff --git a/src/app.tsx b/src/app.tsx\n@@ -1 +1 @@\n-old\n+new",
  files: [
    {
      path: "src/app.tsx",
      additions: 1,
      deletions: 1,
      diff: "@@ -1 +1 @@\n-old\n+new"
    }
  ],
  additions: 1,
  deletions: 1,
  ...overrides
});

describe("right-pane-diff", () => {
  it("builds an all-changes diff entry across revisions", () => {
    const aggregate = buildAggregateDiffEntry([
      createDiffEntry(),
      createDiffEntry({
        id: "diff-2",
        createdAt: "10:05",
        title: "Updated src/worker.ts",
        diff: "diff --git a/src/worker.ts b/src/worker.ts\n@@ -3 +3 @@\n-old worker\n+new worker",
        files: [
          {
            path: "src/app.tsx",
            additions: 2,
            deletions: 0,
            diff: "@@ -4 +4 @@\n+extra"
          },
          {
            path: "src/worker.ts",
            additions: 1,
            deletions: 1,
            diff: "@@ -3 +3 @@\n-old worker\n+new worker"
          }
        ],
        additions: 3,
        deletions: 1
      })
    ]);

    expect(aggregate?.title).toBe("All changes");
    expect(aggregate?.additions).toBe(4);
    expect(aggregate?.deletions).toBe(2);
    expect(aggregate?.files).toHaveLength(2);
    expect(aggregate?.files[0]?.path).toBe("src/app.tsx");
    expect(aggregate?.files[0]?.additions).toBe(3);
    expect(aggregate?.files[0]?.diff).toContain("@@ -4 +4 @@");
    expect(aggregate?.diff).toContain("diff --git a/src/worker.ts b/src/worker.ts");
  });

  it("parses unified diff lines with hunk-aware line numbers", () => {
    const lines = parseDiffViewerLines(
      "diff --git a/src/app.tsx b/src/app.tsx\n@@ -7,2 +7,2 @@\n-old line\n context line\n+new line"
    );

    expect(lines[0]).toMatchObject({
      kind: "meta",
      oldNumber: null,
      newNumber: null
    });
    expect(lines[1]).toMatchObject({
      kind: "hunk",
      oldNumber: null,
      newNumber: null
    });
    expect(lines[2]).toMatchObject({
      kind: "removed",
      oldNumber: 7,
      newNumber: null
    });
    expect(lines[3]).toMatchObject({
      kind: "context",
      oldNumber: 8,
      newNumber: 7
    });
    expect(lines[4]).toMatchObject({
      kind: "added",
      oldNumber: null,
      newNumber: 8
    });
  });

  it("keeps plus-plus and minus-minus code lines inside hunks", () => {
    const lines = parseDiffViewerLines(
      "diff --git a/src/app.tsx b/src/app.tsx\n@@ -3,2 +3,2 @@\n---flag\n+++counter"
    );

    expect(lines[2]).toMatchObject({
      kind: "removed",
      oldNumber: 3,
      newNumber: null,
      text: "---flag"
    });
    expect(lines[3]).toMatchObject({
      kind: "added",
      oldNumber: null,
      newNumber: 3,
      text: "+++counter"
    });
  });
});
