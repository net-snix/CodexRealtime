import type { TimelineActivityEntry, TimelineState, VoicePreferences } from "@shared";

export type VoiceNarrationCue = {
  key: string;
  text: string;
  terminal: boolean;
};

const cleanText = (value: string | null | undefined, maxLength = 220) => {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
};

const describeActivity = (
  activity: TimelineActivityEntry,
  preferences: VoicePreferences
) => {
  if (activity.activityType === "command_execution" && !preferences.speakToolCalls) {
    return null;
  }

  if (activity.activityType === "plan_update" && !preferences.speakPlanUpdates) {
    return null;
  }

  if (
    activity.activityType !== "command_execution" &&
    activity.activityType !== "plan_update" &&
    !preferences.speakAgentActivity
  ) {
    return null;
  }

  if (activity.activityType === "command_execution") {
    return cleanText(
      activity.detail ?? activity.command ?? activity.label ?? "Running command."
    );
  }

  if (activity.activityType === "collab_agent_tool_call") {
    return cleanText(activity.detail ?? activity.label ?? "Handing work to a subagent.");
  }

  if (activity.activityType === "plan_update") {
    return cleanText(activity.detail ?? activity.label ?? "Updated the plan.");
  }

  if (activity.activityType === "error") {
    return cleanText(activity.detail ?? activity.label ?? "The worker hit an error.");
  }

  return cleanText(activity.detail ?? activity.label);
};

export const createVoiceNarrationCue = ({
  previousTimeline,
  nextTimeline,
  preferences
}: {
  previousTimeline: TimelineState | null;
  nextTimeline: TimelineState;
  preferences: VoicePreferences;
}): VoiceNarrationCue | null => {
  if (!nextTimeline.threadId) {
    return null;
  }

  const previousApprovalCount = previousTimeline?.approvals.length ?? 0;
  const previousUserInputCount = previousTimeline?.userInputs.length ?? 0;

  if (nextTimeline.approvals.length > previousApprovalCount) {
    return {
      key: `approval:${nextTimeline.approvals.at(-1)?.id ?? nextTimeline.threadId}`,
      text: "Approval needed before continuing.",
      terminal: true
    };
  }

  if (nextTimeline.userInputs.length > previousUserInputCount) {
    return {
      key: `input:${nextTimeline.userInputs.at(-1)?.id ?? nextTimeline.threadId}`,
      text: "Need more input to keep going.",
      terminal: true
    };
  }

  const previousEntryId = previousTimeline?.entries.at(-1)?.id ?? null;
  const nextEntry = nextTimeline.entries.at(-1);

  if (nextEntry && nextEntry.id !== previousEntryId) {
    if (nextEntry.kind === "activity") {
      const text = describeActivity(nextEntry, preferences);

      if (text) {
        return {
          key: `entry:${nextEntry.id}`,
          text,
          terminal: false
        };
      }
    }

    if (nextEntry.kind === "message" && nextEntry.role === "assistant" && preferences.speakAgentActivity) {
      const text = cleanText(nextEntry.summary ?? nextEntry.text);

      if (text) {
        return {
          key: `entry:${nextEntry.id}`,
          text,
          terminal: false
        };
      }
    }

    if (nextEntry.kind === "proposedPlan" && preferences.speakPlanUpdates) {
      const text = cleanText(nextEntry.title || nextEntry.text || "Proposed plan ready.");

      if (text) {
        return {
          key: `entry:${nextEntry.id}`,
          text,
          terminal: false
        };
      }
    }
  }

  if (previousTimeline?.isRunning && !nextTimeline.isRunning) {
    return {
      key: `run:${nextTimeline.latestTurn?.id ?? nextTimeline.threadId}:${nextTimeline.runState.phase}`,
      text:
        nextTimeline.runState.phase === "failed"
          ? "Work failed."
          : nextTimeline.runState.phase === "interrupted"
            ? "Work interrupted."
            : "Work complete.",
      terminal: true
    };
  }

  if (!previousTimeline?.isRunning && nextTimeline.isRunning) {
    return {
      key: `run:${nextTimeline.latestTurn?.id ?? nextTimeline.threadId}:started`,
      text: "Codex is working.",
      terminal: false
    };
  }

  return null;
};
