import { randomUUID } from "node:crypto";
import type {
  TimelineApproval,
  TimelineChangedFile,
  TimelineDiffEntry,
  TimelineEntry,
  TimelineMessageEntry,
  TimelinePlan,
  TimelineProposedPlanEntry,
  TimelineRunState,
  TimelineState,
  TimelineTurn,
  TimelineUserInputQuestion,
  TimelineUserInputRequest
} from "@shared";
import { summarizeActivityText } from "./timeline-event-summary";
import {
  normalizeBridgeNotification,
  normalizeBridgeRequest,
  projectTurnRecord,
  type NotificationPayload,
  type RequestPayload,
  type TimelineRuntimeMutation,
  type TurnRecord,
} from "./timeline-runtime-events";

export { isRecord } from "./timeline-runtime-events";
export type {
  NotificationPayload,
  RequestPayload,
  ThreadItem,
  TurnRecord,
  TurnRef
} from "./timeline-runtime-events";

const MAX_TIMELINE_ENTRIES = 240;
const MAX_HISTORY_TURNS = 64;
const MAX_TURN_DIFFS = 48;
const OPTIMISTIC_USER_EVENT_PREFIX = "optimistic-user:";

const nowIso = () => new Date().toISOString();

const cloneChangedFile = (file: TimelineChangedFile): TimelineChangedFile => ({ ...file });

const cloneTimelinePlan = (plan: TimelinePlan | null): TimelinePlan | null =>
  plan
    ? {
        ...plan,
        steps: [...plan.steps]
      }
    : null;

const cloneTimelineTurn = (turn: TimelineTurn | null): TimelineTurn | null =>
  turn
    ? {
        ...turn
      }
    : null;

const cloneTimelineApproval = (approval: TimelineApproval): TimelineApproval => ({
  ...approval,
  availableDecisions: [...approval.availableDecisions]
});

const cloneTimelineQuestion = (
  question: TimelineUserInputQuestion
): TimelineUserInputQuestion => ({
  ...question,
  options: [...question.options]
});

const cloneTimelineUserInput = (
  request: TimelineUserInputRequest
): TimelineUserInputRequest => ({
  ...request,
  questions: request.questions.map(cloneTimelineQuestion)
});

const cloneTimelineEntry = (entry: TimelineEntry): TimelineEntry => {
  if (entry.kind === "message") {
    return { ...entry };
  }

  if (entry.kind === "activity") {
    return {
      ...entry,
      changedFiles: entry.changedFiles.map(cloneChangedFile)
    };
  }

  if (entry.kind === "proposedPlan") {
    return {
      ...entry,
      steps: [...entry.steps]
    };
  }

  return {
    ...entry,
    files: entry.files.map(cloneChangedFile)
  };
};

const trimEntries = (entries: TimelineEntry[]) =>
  entries.length > MAX_TIMELINE_ENTRIES ? entries.slice(-MAX_TIMELINE_ENTRIES) : entries;

const trimDiffs = (entries: TimelineDiffEntry[]) =>
  entries.length > MAX_TURN_DIFFS ? entries.slice(-MAX_TURN_DIFFS) : entries;

const findEntryIndex = (entries: TimelineEntry[], entryId: string) =>
  entries.findIndex((candidate) => candidate.id === entryId);

const findLatestAssistantMessageId = (entries: TimelineEntry[], turnId: string | null) => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];

    if (!entry || entry.kind !== "message" || entry.role !== "assistant") {
      continue;
    }

    if (turnId && entry.turnId !== turnId) {
      continue;
    }

    return entry.id;
  }

  return null;
};

const replaceEntry = (entries: TimelineEntry[], nextEntry: TimelineEntry) => {
  const nextEntries = [...entries];
  const existingIndex = findEntryIndex(nextEntries, nextEntry.id);

  if (existingIndex >= 0) {
    nextEntries[existingIndex] = nextEntry;
  } else {
    nextEntries.push(nextEntry);
  }

  return trimEntries(nextEntries);
};

const isOptimisticUserMessage = (entry: TimelineEntry) =>
  entry.kind === "message" &&
  entry.role === "user" &&
  entry.id.startsWith(OPTIMISTIC_USER_EVENT_PREFIX);

const replaceOptimisticMessage = (
  entries: TimelineEntry[],
  entry: TimelineMessageEntry
) => {
  const optimisticIndex = entries.findIndex(
    (candidate) =>
      isOptimisticUserMessage(candidate) &&
      candidate.kind === "message" &&
      candidate.text === entry.text
  );

  if (optimisticIndex < 0) {
    return null;
  }

  const nextEntries = [...entries];
  nextEntries[optimisticIndex] = entry;
  return trimEntries(nextEntries);
};

const attachPendingDiffsToAssistant = (
  state: TimelineState,
  assistantMessage: TimelineMessageEntry
) => {
  if (assistantMessage.role !== "assistant") {
    return;
  }

  const nextTurnDiffs = state.turnDiffs.map((diff) =>
    diff.turnId === assistantMessage.turnId && diff.assistantMessageId === null
      ? {
          ...diff,
          assistantMessageId: assistantMessage.id
        }
      : diff
  );

  const nextEntries = state.entries.map((entry) =>
    entry.kind === "diffSummary" &&
    entry.turnId === assistantMessage.turnId &&
    entry.assistantMessageId === null
      ? {
          ...entry,
          assistantMessageId: assistantMessage.id
        }
      : entry
  );

  state.turnDiffs = trimDiffs(nextTurnDiffs);
  state.entries = trimEntries(nextEntries);

  if (
    state.activeDiffPreview &&
    state.activeDiffPreview.turnId === assistantMessage.turnId &&
    state.activeDiffPreview.assistantMessageId === null
  ) {
    state.activeDiffPreview = {
      ...state.activeDiffPreview,
      assistantMessageId: assistantMessage.id
    };
  }
};

const upsertTimelineEntry = (state: TimelineState, entry: TimelineEntry) => {
  if (entry.kind === "message" && entry.role === "user") {
    const replaced = replaceOptimisticMessage(state.entries, entry);

    if (replaced) {
      state.entries = replaced;
      return;
    }
  }

  state.entries = replaceEntry(state.entries, entry);

  if (entry.kind === "message" && entry.role === "assistant") {
    attachPendingDiffsToAssistant(state, entry);
  }
};

const upsertTurnDiff = (state: TimelineState, entry: TimelineDiffEntry) => {
  const assistantMessageId =
    entry.assistantMessageId ?? findLatestAssistantMessageId(state.entries, entry.turnId);
  const nextEntry =
    assistantMessageId && assistantMessageId !== entry.assistantMessageId
      ? {
          ...entry,
          assistantMessageId
        }
      : entry;
  const nextDiffs = [...state.turnDiffs];
  const existingIndex = nextDiffs.findIndex((candidate) => candidate.id === nextEntry.id);

  if (existingIndex >= 0) {
    nextDiffs[existingIndex] = nextEntry;
  } else {
    nextDiffs.push(nextEntry);
  }

  state.turnDiffs = trimDiffs(nextDiffs);
  state.activeDiffPreview = nextEntry;
  state.entries = replaceEntry(state.entries, nextEntry);
};

const upsertProposedPlan = (state: TimelineState, entry: TimelineProposedPlanEntry) => {
  state.latestProposedPlan = {
    id: entry.id,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    turnId: entry.turnId,
    title: entry.title,
    text: entry.text,
    steps: [...entry.steps]
  };
  upsertTimelineEntry(state, entry);
};

const emptyTimelineRunState: TimelineRunState = {
  phase: "idle",
  label: null
};

export const emptyTimelineState = (threadId: string | null = null): TimelineState => ({
  threadId,
  entries: [],
  activePlan: null,
  latestProposedPlan: null,
  turnDiffs: [],
  activeDiffPreview: null,
  approvals: [],
  userInputs: [],
  isRunning: false,
  runState: emptyTimelineRunState,
  activeWorkStartedAt: null,
  latestTurn: null
});

export const cloneTimelineState = (state: TimelineState): TimelineState => ({
  ...state,
  entries: state.entries.map(cloneTimelineEntry),
  activePlan: cloneTimelinePlan(state.activePlan),
  latestProposedPlan: cloneTimelinePlan(state.latestProposedPlan),
  turnDiffs: state.turnDiffs.map((entry) => ({
    ...entry,
    files: entry.files.map(cloneChangedFile)
  })),
  activeDiffPreview: state.activeDiffPreview
    ? {
        ...state.activeDiffPreview,
        files: state.activeDiffPreview.files.map(cloneChangedFile)
      }
    : null,
  approvals: state.approvals.map(cloneTimelineApproval),
  userInputs: state.userInputs.map(cloneTimelineUserInput),
  runState: { ...state.runState },
  latestTurn: cloneTimelineTurn(state.latestTurn)
});

const ensureLiveTimeline = (state: TimelineState, threadId: string) =>
  state.threadId === threadId ? cloneTimelineState(state) : emptyTimelineState(threadId);

const resolveRunState = (state: TimelineState): TimelineRunState => {
  if (
    state.runState.phase === "historyUnavailable" &&
    !state.isRunning &&
    !state.latestTurn &&
    state.entries.length === 0
  ) {
    return state.runState;
  }

  if (state.approvals.some((approval) => !approval.isSubmitting)) {
    return { phase: "waitingApproval", label: "Waiting for approval" };
  }

  if (state.userInputs.some((request) => !request.isSubmitting)) {
    return { phase: "waitingUserInput", label: "Waiting for input" };
  }

  if (state.runState.phase === "steering" && state.isRunning) {
    return state.runState;
  }

  if (state.isRunning || state.latestTurn?.status === "inProgress") {
    const hasOptimisticUserMessage = state.entries.some(isOptimisticUserMessage);
    return {
      phase: hasOptimisticUserMessage ? "starting" : "running",
      label: hasOptimisticUserMessage ? "Starting" : "Working"
    };
  }

  if (state.latestTurn?.status === "interrupted") {
    return { phase: "interrupted", label: "Interrupted" };
  }

  if (state.latestTurn?.status === "failed") {
    return { phase: "failed", label: "Failed" };
  }

  return { phase: "idle", label: "Idle" };
};

const applyRuntimeMutation = (
  state: TimelineState,
  mutation: TimelineRuntimeMutation
) => {
  switch (mutation.type) {
    case "upsertEntry": {
      if (mutation.entry.kind === "proposedPlan") {
        upsertProposedPlan(state, mutation.entry);
        return;
      }

      if (mutation.entry.kind === "diffSummary") {
        upsertTurnDiff(state, mutation.entry);
        return;
      }

      upsertTimelineEntry(state, mutation.entry);
      return;
    }

    case "appendAssistantDelta": {
      const existing = state.entries.find(
        (entry) => entry.kind === "message" && entry.id === mutation.id
      );
      const currentText =
        existing && existing.kind === "message" ? existing.text : "";
      const nextMessage: TimelineMessageEntry = {
        id: mutation.id,
        kind: "message",
        role: "assistant",
        text: `${currentText}${mutation.delta}`,
        createdAt: existing?.createdAt ?? mutation.createdAt,
        completedAt: null,
        turnId: mutation.turnId,
        summary: summarizeActivityText(`${currentText}${mutation.delta}`),
        isStreaming: true,
        providerLabel:
          existing && existing.kind === "message" ? existing.providerLabel : null
      };

      upsertTimelineEntry(state, nextMessage);
      return;
    }

    case "setActivePlan":
      state.activePlan = mutation.plan
        ? {
            ...mutation.plan,
            steps: [...mutation.plan.steps]
          }
        : null;
      return;

    case "upsertLatestProposedPlan": {
      const currentPlan = state.latestProposedPlan;
      const shouldAppend =
        mutation.merge === "append" &&
        currentPlan &&
        currentPlan.id === mutation.plan.id;
      const nextText = shouldAppend
        ? `${currentPlan.text}${mutation.plan.text}`
        : mutation.plan.text;
      const nextPlan: TimelineProposedPlanEntry = {
        ...mutation.plan,
        kind: "proposedPlan",
        text: nextText
      };

      upsertProposedPlan(state, nextPlan);
      return;
    }

    case "upsertTurnDiff":
      upsertTurnDiff(state, mutation.diff);
      return;

    case "setActiveDiffPreview":
      if (!mutation.diff) {
        state.activeDiffPreview = null;
        return;
      }

      upsertTurnDiff(state, mutation.diff);
      return;

    case "upsertApproval": {
      const nextApprovals = state.approvals.filter(
        (approval) => approval.id !== mutation.approval.id
      );
      nextApprovals.push(cloneTimelineApproval(mutation.approval));
      state.approvals = nextApprovals;
      return;
    }

    case "upsertUserInput": {
      const nextRequests = state.userInputs.filter(
        (request) => request.id !== mutation.request.id
      );
      nextRequests.push(cloneTimelineUserInput(mutation.request));
      state.userInputs = nextRequests;
      return;
    }

    case "resolveRequest":
      state.approvals = state.approvals.filter(
        (approval) => approval.id !== mutation.requestId
      );
      state.userInputs = state.userInputs.filter(
        (request) => request.id !== mutation.requestId
      );
      return;

    case "setRunState":
      state.runState = { ...mutation.runState };
      state.isRunning = mutation.isRunning;
      state.latestTurn = cloneTimelineTurn(mutation.latestTurn);
      state.activeWorkStartedAt = mutation.activeWorkStartedAt;
      return;
  }
};

const finalizeState = (state: TimelineState) => {
  state.entries = trimEntries(state.entries);
  state.turnDiffs = trimDiffs(state.turnDiffs);
  state.runState = resolveRunState(state);
  return state;
};

export const markApprovalSubmitting = (
  state: TimelineState,
  requestId: string,
  isSubmitting: boolean
) => {
  const nextState = cloneTimelineState(state);
  nextState.approvals = nextState.approvals.map((approval) =>
    approval.id === requestId ? { ...approval, isSubmitting } : approval
  );
  return finalizeState(nextState);
};

export const markUserInputSubmitting = (
  state: TimelineState,
  requestId: string,
  isSubmitting: boolean
) => {
  const nextState = cloneTimelineState(state);
  nextState.userInputs = nextState.userInputs.map((request) =>
    request.id === requestId ? { ...request, isSubmitting } : request
  );
  return finalizeState(nextState);
};

export const buildTimelineState = (
  threadId: string,
  turns: TurnRecord[]
): TimelineState => {
  const nextState = emptyTimelineState(threadId);
  const relevantTurns = turns.slice(-MAX_HISTORY_TURNS);

  for (let index = 0; index < relevantTurns.length; index += 1) {
    const turn = relevantTurns[index] ?? {};
    const projected = projectTurnRecord(turn, index);

    for (const entry of projected.entries) {
      applyRuntimeMutation(nextState, { type: "upsertEntry", entry });
    }

    if (projected.latestProposedPlan) {
      applyRuntimeMutation(nextState, {
        type: "upsertLatestProposedPlan",
        plan: projected.latestProposedPlan,
        merge: "replace"
      });
    }

    for (const diff of projected.diffEntries) {
      applyRuntimeMutation(nextState, { type: "upsertTurnDiff", diff });
    }

    nextState.latestTurn = {
      id: turn.id ?? `turn-${index + 1}`,
      status: turn.status ?? "completed",
      startedAt: typeof turn.startedAt === "string" ? turn.startedAt : null,
      completedAt: typeof turn.completedAt === "string" ? turn.completedAt : null
    };
  }

  nextState.isRunning = nextState.latestTurn?.status === "inProgress";
  nextState.activeWorkStartedAt = nextState.isRunning
    ? nextState.latestTurn?.startedAt ?? null
    : null;
  return finalizeState(nextState);
};

export const appendOptimisticUserEvent = (
  state: TimelineState,
  prompt: string
): TimelineState => {
  const trimmedPrompt = prompt.trim();

  if (!trimmedPrompt) {
    return cloneTimelineState(state);
  }

  const nextState = cloneTimelineState(state);
  const createdAt = nowIso();

  upsertTimelineEntry(nextState, {
    id: `${OPTIMISTIC_USER_EVENT_PREFIX}${randomUUID()}`,
    kind: "message",
    role: "user",
    text: trimmedPrompt,
    createdAt,
    completedAt: createdAt,
    turnId: nextState.threadId,
    summary: summarizeActivityText(trimmedPrompt),
    isStreaming: false,
    providerLabel: null
  });
  nextState.isRunning = true;
  nextState.activeWorkStartedAt = createdAt;
  return finalizeState(nextState);
};

const isSettledTurnMethod = (method: string) => {
  const normalized = method
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[.\-/\s]+/g, "_")
    .toLowerCase();

  return normalized === "turn_completed" || normalized === "turn_aborted";
};

export const applyBridgeNotification = async (
  currentState: TimelineState,
  payload: NotificationPayload,
  isCurrentThread: (threadId: string) => boolean,
  hydrateTimeline: (threadId: string, currentState: TimelineState) => Promise<TimelineState>
): Promise<TimelineState> => {
  const normalized = normalizeBridgeNotification(payload);
  const threadId = normalized.threadId;

  if (!threadId || !isCurrentThread(threadId)) {
    return currentState;
  }

  const nextState = ensureLiveTimeline(currentState, threadId);

  for (const mutation of normalized.mutations) {
    applyRuntimeMutation(nextState, mutation);
  }

  finalizeState(nextState);

  if (isSettledTurnMethod(payload.method)) {
    return hydrateTimeline(threadId, nextState);
  }

  return nextState;
};

export const applyBridgeRequest = (
  currentState: TimelineState,
  payload: RequestPayload,
  isCurrentThread: (threadId: string) => boolean
): TimelineState => {
  const normalized = normalizeBridgeRequest(payload);
  const threadId = normalized.threadId;

  if (!threadId || !isCurrentThread(threadId)) {
    return currentState;
  }

  const nextState = ensureLiveTimeline(currentState, threadId);

  for (const mutation of normalized.mutations) {
    applyRuntimeMutation(nextState, mutation);
  }

  return finalizeState(nextState);
};
