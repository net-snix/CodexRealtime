import type { TimelineChangedFile, TimelineEntry } from "@shared";

export type TimelinePresentation = {
  variant: "message" | "activity" | "plan" | "diff";
  badge: string | null;
  tone:
    | "user"
    | "assistant"
    | "commentary"
    | "tool"
    | "system"
    | "plan"
    | "patch"
    | "success"
    | "warning";
  title: string;
  body: string | null;
  monospace?: boolean;
  metaLabel: string | null;
  files?: TimelineChangedFile[];
  additions?: number;
  deletions?: number;
};

const getMetaLabel = (createdAt: string) => (createdAt === "Thread history" ? null : createdAt);

const getChangedFileLabel = (files: TimelineChangedFile[]) => {
  if (files.length === 0) {
    return null;
  }

  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);

  return additions > 0 || deletions > 0 ? `+${additions} -${deletions}` : null;
};

export const presentTimelineEvent = (
  entry: TimelineEntry,
  isWorkingLogMode = false
): TimelinePresentation => {
  if (entry.kind === "message") {
    if (entry.role === "user") {
      return {
        variant: "message",
        badge: null,
        tone: "user",
        title: entry.text,
        body: null,
        metaLabel: null
      };
    }

    if (isWorkingLogMode && entry.summary?.trim()) {
      return {
        variant: "activity",
        badge: null,
        tone: "commentary",
        title: entry.summary.trim(),
        body: null,
        metaLabel: getMetaLabel(entry.createdAt)
      };
    }

    return {
      variant: "message",
      badge: null,
      tone: "assistant",
      title: entry.text,
      body: null,
      metaLabel: getMetaLabel(entry.createdAt)
    };
  }

  if (entry.kind === "work") {
    if (entry.command) {
      return {
        variant: "activity",
        badge: "Command",
        tone: "tool",
        title: entry.label,
        body: entry.detail,
        monospace: true,
        metaLabel: getMetaLabel(entry.createdAt)
      };
    }

    if (entry.changedFiles.length > 0) {
      return {
        variant: "activity",
        badge: "Edit",
        tone: "success",
        title: entry.label,
        body: entry.detail,
        metaLabel: getChangedFileLabel(entry.changedFiles) ?? getMetaLabel(entry.createdAt)
      };
    }

    const tone =
      entry.tone === "thinking"
        ? "commentary"
        : entry.tone === "error"
          ? "warning"
          : "system";

    return {
      variant: "activity",
      badge: entry.tone === "thinking" ? "Think" : "Work",
      tone,
      title: entry.label,
      body: entry.detail,
      metaLabel: getMetaLabel(entry.createdAt)
    };
  }

  if (entry.kind === "plan") {
    return {
      variant: "plan",
      badge: "Plan",
      tone: "plan",
      title: entry.title,
      body: entry.text,
      metaLabel: getMetaLabel(entry.createdAt)
    };
  }

  return {
    variant: "diff",
    badge: "Diff",
    tone: "success",
    title: entry.title,
    body: entry.diff,
    metaLabel: `+${entry.additions} -${entry.deletions}`,
    files: entry.files,
    additions: entry.additions,
    deletions: entry.deletions
  };
};
