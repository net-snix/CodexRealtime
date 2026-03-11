const MAX_ACTIVITY_SUMMARY = 120;
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

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();
const basename = (value: string) => value.split("/").filter(Boolean).at(-1) ?? value;

const stripGreeting = (value: string) => value.replace(/^Hi [^.]+\.\s*/i, "");

const truncate = (value: string, maxLength = MAX_ACTIVITY_SUMMARY) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1).trimEnd()}…` : value;

const firstSentence = (value: string) => {
  const [sentence] = value.split(/(?<=[.!?])\s+/);
  return sentence?.trim() ?? value.trim();
};

export const summarizeActivityText = (text: string) => {
  const normalized = normalizeWhitespace(stripGreeting(text));

  if (!normalized) {
    return "";
  }

  return truncate(firstSentence(normalized).replace(/[.!?]+$/, ""));
};

export const summarizeCommand = (command: string) => {
  const trimmed = normalizeWhitespace(command);
  return trimmed ? truncate(`Ran ${trimmed}`, 96) : "Ran command";
};

const countDiffStats = (diff: string) => {
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split("\n")) {
    if (!line) {
      continue;
    }

    if (DIFF_METADATA_PREFIXES.some((prefix) => line.startsWith(prefix))) {
      continue;
    }

    if (line.startsWith("+")) {
      additions += 1;
      continue;
    }

    if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  return { additions, deletions };
};

export const buildFileChangeEvents = <
  T extends {
    id: string;
    createdAt: string;
  }
>(
  baseEvent: T,
  changes: Array<{ path?: string; diff?: string }>
) =>
  changes
    .filter((change): change is { path: string; diff?: string } => typeof change.path === "string")
    .map((change, index) => {
      const stats = countDiffStats(change.diff ?? "");

      return {
        ...baseEvent,
        id: `${baseEvent.id}-${index}`,
        kind: "system" as const,
        text: `Edited ${basename(change.path)}`,
        summary: `Edited ${basename(change.path)}`,
        path: change.path,
        additions: stats.additions,
        deletions: stats.deletions
      };
    });
