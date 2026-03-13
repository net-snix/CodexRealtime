export type DiffStats = {
  additions: number;
  deletions: number;
};

const DIFF_METADATA_PREFIXES = [
  "diff --git",
  "index ",
  "@@",
  "---",
  "+++",
  "new file mode",
  "deleted file mode",
  "rename from",
  "rename to",
  "similarity index"
] as const;

const isDiffMetadataLine = (diff: string, lineStart: number) =>
  DIFF_METADATA_PREFIXES.some((prefix) => diff.startsWith(prefix, lineStart));

export const countDiffStats = (diff: string): DiffStats => {
  let additions = 0;
  let deletions = 0;
  let lineStart = 0;

  // Diff payloads can be large. Scan line-by-line without allocating split arrays.
  while (lineStart <= diff.length) {
    const newlineIndex = diff.indexOf("\n", lineStart);
    const lineEnd = newlineIndex === -1 ? diff.length : newlineIndex;

    if (lineEnd > lineStart && !isDiffMetadataLine(diff, lineStart)) {
      const marker = diff[lineStart];

      if (marker === "+") {
        additions += 1;
      } else if (marker === "-") {
        deletions += 1;
      }
    }

    if (newlineIndex === -1) {
      break;
    }

    lineStart = newlineIndex + 1;
  }

  return { additions, deletions };
};
