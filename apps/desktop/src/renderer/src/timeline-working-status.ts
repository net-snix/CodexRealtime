import { useEffect, useState } from "react";
import type { TimelineEvent } from "@shared";
import { presentTimelineEvent } from "./timeline-presenter";

const THINKING_FRAMES = ["Thinking", "Thinking.", "Thinking..", "Thinking..."];
const WORKING_LABELS = new Map<string, string>([
  ["Command", "Running"],
  ["Edit", "Editing"],
  ["Plan", "Planning"],
  ["Retry", "Reconnecting"]
]);

export const useThinkingLabel = (enabled: boolean) => {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setFrameIndex(0);
      return;
    }

    const intervalId = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % THINKING_FRAMES.length);
    }, 420);

    return () => window.clearInterval(intervalId);
  }, [enabled]);

  return enabled ? THINKING_FRAMES[frameIndex] : "";
};

export const getLatestWorkingStatus = (
  events: TimelineEvent[],
  isWorkingLogMode: boolean
) => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].createdAt === "Thread history") {
      continue;
    }

    const presentation = presentTimelineEvent(events[index], isWorkingLogMode);

    if (presentation.variant === "activity" && presentation.title.trim()) {
      return presentation.title.trim();
    }
  }

  return null;
};

export const getWorkingStatusLabel = (
  events: TimelineEvent[],
  isWorkingLogMode: boolean,
  thinkingLabel: string,
  isResolvingRequests: boolean
) => {
  if (isResolvingRequests) {
    return "Waiting";
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].createdAt === "Thread history") {
      continue;
    }

    const presentation = presentTimelineEvent(events[index], isWorkingLogMode);
    const label = presentation.badge ? WORKING_LABELS.get(presentation.badge) : null;

    if (label) {
      return label;
    }
  }

  return thinkingLabel || "Thinking";
};
