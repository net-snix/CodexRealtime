import { describe, expect, it } from "vitest";
import { normalizeProviderRuntimeItem } from "./provider-runtime";

describe("normalizeProviderRuntimeItem", () => {
  it("ignores unified diff headers without dropping real content lines", () => {
    const item = normalizeProviderRuntimeItem({
      type: "fileChange",
      files: [
        {
          path: "src/app.ts",
          diff: [
            "--- a/src/app.ts",
            "+++ b/src/app.ts",
            "@@ -3,2 +3,2 @@",
            "---flag",
            "+++counter",
            "-old line",
            "+new line"
          ].join("\n")
        }
      ]
    });

    expect(item).toMatchObject({
      kind: "file_change",
      files: [
        {
          path: "src/app.ts",
          additions: 2,
          deletions: 2
        }
      ]
    });
  });

  it("counts the final diff line without a trailing newline", () => {
    const item = normalizeProviderRuntimeItem({
      type: "fileChange",
      files: [
        {
          path: "src/app.ts",
          diff: "+added\n-removed"
        }
      ]
    });

    expect(item).toMatchObject({
      kind: "file_change",
      files: [
        {
          path: "src/app.ts",
          additions: 1,
          deletions: 1
        }
      ]
    });
  });
});
