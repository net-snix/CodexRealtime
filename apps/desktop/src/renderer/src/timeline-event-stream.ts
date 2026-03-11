import type { TimelineEntry } from "@shared";
import { presentTimelineEvent, type TimelinePresentation } from "./timeline-presenter";

const WORKING_LABELS = new Map<string, string>([
  ["Command", "Running"],
  ["Edit", "Editing"],
  ["Plan", "Planning"],
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
      kind: "commandCluster";
      id: string;
      items: PresentedTimelineEvent[];
    };

const isCommandActivity = (item: PresentedTimelineEvent) =>
  item.entry.kind === "work" && Boolean(item.entry.command);

export const buildPresentedTimeline = (
  entries: TimelineEntry[],
  isWorkingLogMode: boolean
) => {
  const presentedEntries = entries.map((entry) => ({
    entry,
    presentation: presentTimelineEvent(entry, isWorkingLogMode)
  }));
  let latestWorkingStatus: string | null = null;
  let currentWorkingLabel: string | null = null;

  for (let index = presentedEntries.length - 1; index >= 0; index -= 1) {
    const { entry, presentation } = presentedEntries[index];

    if (entry.createdAt === "Thread history" || presentation.variant === "message") {
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

    if (!isCommandActivity(current)) {
      groupedEntries.push({
        kind: "entry",
        item: current
      });
      continue;
    }

    const commandItems = [current];

    while (index + 1 < presentedEntries.length && isCommandActivity(presentedEntries[index + 1])) {
      index += 1;
      commandItems.push(presentedEntries[index]);
    }

    if (commandItems.length === 1) {
      groupedEntries.push({
        kind: "entry",
        item: current
      });
      continue;
    }

    groupedEntries.push({
      kind: "commandCluster",
      id: `${commandItems[0].entry.id}-cluster-${commandItems.at(-1)?.entry.id ?? "end"}`,
      items: commandItems
    });
  }

  return {
    entries: groupedEntries,
    latestWorkingStatus,
    currentWorkingLabel
  };
};

export const getTimelineWorkingLabels = (
  entries: TimelineEntry[],
  isWorkingLogMode: boolean
) => {
  const { latestWorkingStatus, currentWorkingLabel } = buildPresentedTimeline(
    entries,
    isWorkingLogMode
  );

  return {
    latestWorkingStatus,
    currentWorkingLabel
  };
};
