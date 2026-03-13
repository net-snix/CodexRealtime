import { describe, expect, it } from "vitest";
import { countDiffStats } from "./diff-stats";

describe("countDiffStats", () => {
  it("ignores unified diff metadata lines", () => {
    expect(
      countDiffStats(
        [
          "diff --git a/src/app.ts b/src/app.ts",
          "index 123..456 100644",
          "--- a/src/app.ts",
          "+++ b/src/app.ts",
          "@@ -1,2 +1,2 @@",
          "-before",
          "+after",
          "rename from old.ts",
          "rename to new.ts",
          "similarity index 92%"
        ].join("\n")
      )
    ).toEqual({
      additions: 1,
      deletions: 1
    });
  });

  it("counts the final diff line without requiring a trailing newline", () => {
    expect(countDiffStats("+added\n-removed")).toEqual({
      additions: 1,
      deletions: 1
    });
  });
});
