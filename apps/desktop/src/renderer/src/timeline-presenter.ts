import type { TimelineEvent } from "@shared";

export type TimelinePresentation = {
  variant: "message" | "activity";
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
};

const getEventMetaLabel = (createdAt: string) =>
  createdAt === "Thread history" ? null : createdAt;

const COMMENTARY_ACTIVITY_BADGES: Array<[prefix: string, badge: string, tone: TimelinePresentation["tone"]]> =
  [
    ["Plan update:", "Plan", "plan"],
    ["Explored ", "Explore", "system"],
    ["Edited ", "Edit", "success"],
    ["Reconnecting", "Retry", "warning"],
    ["Read ", "Read", "system"],
    ["Opened ", "Open", "system"],
    ["Updated ", "Update", "system"],
    ["Searching ", "Search", "system"],
    ["Ran ", "Command", "tool"]
  ];

const getCompactCommentaryBadge = (text: string) =>
  COMMENTARY_ACTIVITY_BADGES.find(([prefix]) => text.startsWith(prefix)) ?? null;

export const presentTimelineEvent = (
  event: TimelineEvent,
  isWorkingLogMode = false
): TimelinePresentation => {
  const fallbackMetaLabel = getEventMetaLabel(event.createdAt);

  if (event.kind === "user") {
    return {
      variant: "message",
      badge: null,
      tone: "user",
      title: event.text,
      body: null,
      metaLabel: null
    };
  }

  if (event.kind === "assistant") {
    if (isWorkingLogMode) {
      return {
        variant: "activity",
        badge: null,
        tone: "commentary",
        title: event.summary?.trim() || event.text,
        body: null,
        metaLabel: fallbackMetaLabel
      };
    }

    return {
      variant: "message",
      badge: "Codex",
      tone: "assistant",
      title: event.text,
      body: null,
      metaLabel: fallbackMetaLabel
    };
  }

  if (event.kind === "commentary") {
    const compact = getCompactCommentaryBadge(event.summary ?? event.text);
    const [, badge = "Log", tone = "commentary"] = compact ?? [];

    return {
      variant: "activity",
      badge,
      tone,
      title: event.summary?.trim() || event.text.replace("Plan update:", "").trim(),
      body: null,
      metaLabel: fallbackMetaLabel
    };
  }

  if (event.detail !== undefined && event.path === undefined) {
    return {
      variant: "activity",
      badge: "Command",
      tone: "tool",
      title: event.summary?.trim() || event.text,
      body: null,
      monospace: true,
      metaLabel: fallbackMetaLabel
    };
  }

  if (event.path || event.additions !== undefined || event.deletions !== undefined) {
    const diffLabel =
      event.additions !== undefined && event.deletions !== undefined
        ? `+${event.additions ?? 0} -${event.deletions ?? 0}`
        : fallbackMetaLabel;

    return {
      variant: "activity",
      badge: "Edit",
      tone: "success",
      title: event.summary?.trim() || event.text,
      body: null,
      metaLabel: diffLabel
    };
  }

  return {
    variant: "activity",
    badge: "State",
    tone: "system",
    title: event.summary?.trim() || event.text,
    body: null,
    metaLabel: fallbackMetaLabel
  };
};
