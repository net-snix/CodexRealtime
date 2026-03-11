import type { TimelineMessageEntry, TimelineState } from "@shared";

const OPTIMISTIC_USER_EVENT_PREFIX = "optimistic-user:";

const isOptimisticUserEntry = (entry: TimelineMessageEntry, entryId: string) =>
  entry.role === "user" && entry.id === entryId;

export const createOptimisticUserEventId = () =>
  `${OPTIMISTIC_USER_EVENT_PREFIX}${globalThis.crypto.randomUUID()}`;

export const applyOptimisticTurnStart = (
  state: TimelineState,
  prompt: string,
  entryId: string
): TimelineState => {
  const trimmedPrompt = prompt.trim();

  if (!trimmedPrompt) {
    return state;
  }

  return {
    ...state,
    entries: [
      ...state.entries,
      {
        id: entryId,
        kind: "message",
        role: "user",
        text: trimmedPrompt,
        createdAt: "Live update",
        completedAt: null,
        turnId: state.threadId,
        summary: trimmedPrompt,
        isStreaming: false,
        providerLabel: null
      } satisfies TimelineMessageEntry
    ],
    isRunning: true,
    runState: {
      phase: "starting",
      label: "Starting"
    },
    activeWorkStartedAt: "Live update"
  };
};

export const removeOptimisticTurnStart = (
  state: TimelineState,
  entryId: string
): TimelineState => ({
  ...state,
  entries: state.entries.filter(
    (entry) => !(entry.kind === "message" && isOptimisticUserEntry(entry, entryId))
  )
});
