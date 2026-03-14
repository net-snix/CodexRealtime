import type { TimelineEntry } from "@shared";
import { presentTimelineEvent, type TimelinePresentation } from "./timeline-presenter";

const WORKING_LABELS = new Map<string, string>([
  ["Command", "Running"],
  ["Tool", "Working"],
  ["Subagent", "Delegating"],
  ["Search", "Searching"],
  ["Image", "Inspecting"],
  ["Plan update", "Planning"],
  ["Proposed plan", "Planning"],
  ["Think", "Thinking"],
  ["Work", "Working"]
]);

export type PresentedTimelineEvent = {
  entry: TimelineEntry;
  presentation: TimelinePresentation;
};

export type PresentedTimelineEntry =
  | {
      kind: "entry";
      item: PresentedTimelineEvent;
    }
  | {
      kind: "activityCluster";
      id: string;
      items: PresentedTimelineEvent[];
    };

export type PresentedTimeline = {
  entries: PresentedTimelineEntry[];
  latestWorkingStatus: string | null;
  currentWorkingLabel: string | null;
};

const isActivityEntry = (item: PresentedTimelineEvent) => item.entry.kind === "activity";

export const buildPresentedTimeline = (
  entries: TimelineEntry[],
  isWorkingLogMode: boolean
): PresentedTimeline => {
  const presentedEntries = entries.map((entry) => ({
    entry,
    presentation: presentTimelineEvent(entry, isWorkingLogMode)
  }));
  let latestWorkingStatus: string | null = null;
  let currentWorkingLabel: string | null = null;

  for (let index = presentedEntries.length - 1; index >= 0; index -= 1) {
    const { entry, presentation } = presentedEntries[index];

    if (
      entry.createdAt === "Thread history" ||
      presentation.variant === "message" ||
      presentation.variant === "diff"
    ) {
      continue;
    }

    if (!latestWorkingStatus && presentation.title.trim()) {
      latestWorkingStatus = presentation.title.trim();
    }

    if (!currentWorkingLabel && presentation.badge) {
      currentWorkingLabel = WORKING_LABELS.get(presentation.badge) ?? null;
    }

    if (latestWorkingStatus && currentWorkingLabel) {
      break;
    }
  }

  const groupedEntries: PresentedTimelineEntry[] = [];

  for (let index = 0; index < presentedEntries.length; index += 1) {
    const current = presentedEntries[index];

    if (!isActivityEntry(current)) {
      groupedEntries.push({
        kind: "entry",
        item: current
      });
      continue;
    }

    const activityItems = [current];

    while (index + 1 < presentedEntries.length && isActivityEntry(presentedEntries[index + 1])) {
      index += 1;
      activityItems.push(presentedEntries[index]);
    }

    if (activityItems.length === 1) {
      groupedEntries.push({
        kind: "entry",
        item: current
      });
      continue;
    }

    groupedEntries.push({
      kind: "activityCluster",
      id: `${activityItems[0].entry.id}-cluster-${activityItems.at(-1)?.entry.id ?? "end"}`,
      items: activityItems
    });
  }

  return {
    entries: groupedEntries,
    latestWorkingStatus,
    currentWorkingLabel
  };
};
