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

const ACTIVITY_BADGES: Record<
  Extract<TimelineEntry, { kind: "activity" }>["activityType"],
  TimelinePresentation["badge"]
> = {
  reasoning: "Think",
  command_execution: "Command",
  mcp_tool_call: "Tool",
  dynamic_tool_call: "Tool",
  collab_agent_tool_call: "Subagent",
  web_search: "Search",
  image_view: "Image",
  plan_update: "Plan update",
  review_entered: "Review",
  review_exited: "Review",
  context_compaction: "Compaction",
  error: "Error",
  unknown: "Work"
};

const activityTone = (
  entry: Extract<TimelineEntry, { kind: "activity" }>
): TimelinePresentation["tone"] => {
  if (entry.activityType === "error" || entry.tone === "error") return "warning";
  if (entry.activityType === "command_execution") return "tool";
  if (entry.activityType === "mcp_tool_call" || entry.activityType === "dynamic_tool_call") {
    return "tool";
  }
  if (entry.activityType === "collab_agent_tool_call") return "plan";
  if (entry.activityType === "web_search" || entry.activityType === "image_view") return "system";
  if (entry.activityType === "reasoning") return "commentary";
  if (entry.activityType === "plan_update") return "plan";
  if (entry.changedFiles.length > 0) return "success";
  return entry.tone === "thinking" ? "commentary" : "system";
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

  if (entry.kind === "activity") {
    if (entry.command) {
      return {
        variant: "activity",
        badge: ACTIVITY_BADGES[entry.activityType],
        tone: activityTone(entry),
        title: entry.label,
        body: entry.detail,
        monospace: true,
        metaLabel: getMetaLabel(entry.createdAt)
      };
    }

    if (entry.changedFiles.length > 0) {
      return {
        variant: "activity",
        badge: ACTIVITY_BADGES[entry.activityType],
        tone: activityTone(entry),
        title: entry.label,
        body: entry.detail,
        metaLabel: getChangedFileLabel(entry.changedFiles) ?? getMetaLabel(entry.createdAt)
      };
    }

    return {
      variant: "activity",
      badge: ACTIVITY_BADGES[entry.activityType],
      tone: activityTone(entry),
      title:
        entry.agentLabel && entry.activityType === "collab_agent_tool_call"
          ? `${entry.agentLabel} · ${entry.label}`
          : entry.label,
      body:
        entry.toolName && entry.detail ? `${entry.toolName}\n${entry.detail}` : entry.detail,
      metaLabel: getMetaLabel(entry.createdAt)
    };
  }

  if (entry.kind === "proposedPlan") {
    return {
      variant: "plan",
      badge: "Proposed plan",
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
