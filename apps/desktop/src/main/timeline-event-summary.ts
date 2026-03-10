import type { TimelineEvent } from "@shared";

type FileChange = {
  path?: string;
  diff?: string;
};

const MAX_ACTIVITY_SUMMARY = 120;

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const stripGreeting = (value: string) => value.replace(/^Hi [^.]+\.\s*/i, "");

const truncate = (value: string, maxLength = MAX_ACTIVITY_SUMMARY) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1).trimEnd()}…` : value;

const firstSentence = (value: string) => {
  const [sentence] = value.split(/(?<=[.!?])\s+/);
  return sentence?.trim() ?? value.trim();
};

const basename = (value: string) => value.split("/").filter(Boolean).at(-1) ?? value;

const countDiffStats = (diff?: string) => {
  const lines = diff?.split("\n") ?? [];
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }

    if (line.startsWith("+")) {
      additions += 1;
    }

    if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  return { additions, deletions };
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

export const buildFileChangeEvents = (
  base: Pick<TimelineEvent, "id" | "kind" | "createdAt">,
  changes: FileChange[] | undefined
): TimelineEvent[] => {
  if (!changes || changes.length === 0) {
    return [
      {
        ...base,
        text: "Edited files",
        summary: "Edited files",
        detail: null,
        path: null,
        additions: null,
        deletions: null
      }
    ];
  }

  return changes.map((change, index) => {
    const path = typeof change.path === "string" ? change.path : null;
    const { additions, deletions } = countDiffStats(change.diff);
    const fileLabel = path ? basename(path) : `file ${index + 1}`;

    return {
      ...base,
      id: `${base.id}-${index}`,
      text: `Edited ${fileLabel}`,
      summary: `Edited ${fileLabel}`,
      detail: path,
      path,
      additions,
      deletions
    } satisfies TimelineEvent;
  });
};
