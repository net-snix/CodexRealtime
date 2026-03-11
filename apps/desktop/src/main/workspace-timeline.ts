import { randomUUID } from "node:crypto";
import type {
  ApprovalDecision,
  TimelineApproval,
  TimelineChangedFile,
  TimelineDiffEntry,
  TimelineEntry,
  TimelineMessageEntry,
  TimelinePlan,
  TimelinePlanEntry,
  TimelinePlanStep,
  TimelineRunState,
  TimelineState,
  TimelineUserInputOption,
  TimelineUserInputQuestion,
  TimelineUserInputRequest,
  TimelineWorkEntry
} from "@shared";
import { summarizeActivityText, summarizeCommand } from "./timeline-event-summary";

export type ThreadItem =
  | {
      type: "userMessage";
      id?: string;
      content?: Array<{ type?: string; text?: string }>;
    }
  | {
      type: "agentMessage";
      id?: string;
      text?: string;
    }
  | {
      type: "plan";
      id?: string;
      text?: string;
    }
  | {
      type: "reasoning";
      id?: string;
      summary?: string[];
      content?: string[];
    }
  | {
      type: "commandExecution";
      id?: string;
      command?: string;
      aggregatedOutput?: string | null;
    }
  | {
      type: "fileChange";
      id?: string;
      changes?: Array<{
        path?: string;
        diff?: string;
        kind?: {
          type?: "add" | "delete" | "update";
          move_path?: string | null;
        };
      }>;
    }
  | {
      type: string;
      id?: string;
    };

export type TurnRecord = {
  id?: string;
  status?: "completed" | "interrupted" | "failed" | "inProgress";
  items?: ThreadItem[];
};

export type TurnRef = {
  id?: string;
  status?: "completed" | "interrupted" | "failed" | "inProgress";
};

export type NotificationPayload = {
  method: string;
  params?: unknown;
};

export type RequestPayload = {
  id: string;
  method: string;
  params?: unknown;
};

type UserMessageItem = Extract<ThreadItem, { type: "userMessage" }>;
type AgentMessageItem = Extract<ThreadItem, { type: "agentMessage" }>;
type PlanItem = Extract<ThreadItem, { type: "plan" }>;
type ReasoningItem = Extract<ThreadItem, { type: "reasoning" }>;
type CommandExecutionItem = Extract<ThreadItem, { type: "commandExecution" }>;
type FileChangeItem = Extract<ThreadItem, { type: "fileChange" }>;

type ProjectedTurn = {
  entries: TimelineEntry[];
  latestPlan: TimelinePlan | null;
  diffEntries: TimelineDiffEntry[];
};

const isUserMessage = (item: ThreadItem): item is UserMessageItem => item.type === "userMessage";
const isAgentMessage = (item: ThreadItem): item is AgentMessageItem => item.type === "agentMessage";
const isPlanItem = (item: ThreadItem): item is PlanItem => item.type === "plan";
const isReasoningItem = (item: ThreadItem): item is ReasoningItem => item.type === "reasoning";
const isCommandExecutionItem = (item: ThreadItem): item is CommandExecutionItem =>
  item.type === "commandExecution";
const isFileChangeItem = (item: ThreadItem): item is FileChangeItem => item.type === "fileChange";

const MAX_TIMELINE_ENTRIES = 160;
const MAX_HISTORY_TURNS = 48;
const MAX_TURN_DIFFS = 32;
const OPTIMISTIC_USER_EVENT_PREFIX = "optimistic-user:";
const DIFF_METADATA_PREFIXES = [
  "diff --git",
  "index ",
  "@@",
  "---",
  "+++",
  "new file mode",
  "deleted file mode",
  "rename from",
  "rename to",
  "similarity index"
];

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

const cloneChangedFile = (file: TimelineChangedFile): TimelineChangedFile => ({
  ...file
});

const cloneTimelineEntry = (entry: TimelineEntry): TimelineEntry => {
  if (entry.kind === "message") {
    return { ...entry };
  }

  if (entry.kind === "work") {
    return {
      ...entry,
      changedFiles: entry.changedFiles.map(cloneChangedFile)
    };
  }

  if (entry.kind === "plan") {
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

const cloneTimelinePlan = (plan: TimelinePlan | null): TimelinePlan | null =>
  plan
    ? {
        ...plan,
        steps: [...plan.steps]
      }
    : null;

const cloneRunState = (runState: TimelineRunState): TimelineRunState => ({
  ...runState
});

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
  runState: {
    phase: "idle",
    label: null
  }
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
  approvals: state.approvals.map((approval) => ({
    ...approval,
    availableDecisions: [...approval.availableDecisions]
  })),
  userInputs: state.userInputs.map((request) => ({
    ...request,
    questions: request.questions.map((question) => ({
      ...question,
      options: [...question.options]
    }))
  })),
  runState: cloneRunState(state.runState)
});

const ensureLiveTimeline = (state: TimelineState, threadId: string) =>
  state.threadId === threadId ? cloneTimelineState(state) : emptyTimelineState(threadId);

export const markApprovalSubmitting = (
  state: TimelineState,
  requestId: string,
  isSubmitting: boolean
) => {
  const nextState = cloneTimelineState(state);
  nextState.approvals = nextState.approvals.map((approval) =>
    approval.id === requestId ? { ...approval, isSubmitting } : approval
  );
  return nextState;
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
  return nextState;
};

const basename = (value: string) => value.split("/").filter(Boolean).at(-1) ?? value;

const extractUserMessageText = (item: UserMessageItem) =>
  (item.content ?? [])
    .filter((entry): entry is { type: "text"; text: string } =>
      entry.type === "text" && typeof entry.text === "string"
    )
    .map((entry) => entry.text.trim())
    .filter(Boolean)
    .join("\n");

const resolvePlanTitle = (text: string) => {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return "Plan";
  }

  return firstLine.replace(/^#+\s*/, "").slice(0, 72);
};

const countDiffStats = (diff: string) => {
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split("\n")) {
    if (!line) {
      continue;
    }

    if (DIFF_METADATA_PREFIXES.some((prefix) => line.startsWith(prefix))) {
      continue;
    }

    if (line.startsWith("+")) {
      additions += 1;
      continue;
    }

    if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  return { additions, deletions };
};

const toChangedFiles = (changes: FileChangeItem["changes"]): TimelineChangedFile[] =>
  (changes ?? [])
    .map((change) => {
      const diff = typeof change.diff === "string" ? change.diff : "";
      const stats = countDiffStats(diff);
      const path = typeof change.path === "string" ? change.path : "";

      if (!path) {
        return null;
      }

      return {
        path,
        additions: stats.additions,
        deletions: stats.deletions,
        diff: diff || null
      } satisfies TimelineChangedFile;
    })
    .filter((change): change is TimelineChangedFile => change !== null);

const summarizeChangedFiles = (files: TimelineChangedFile[]) => {
  if (files.length === 0) {
    return "Edited files";
  }

  if (files.length === 1) {
    return `Edited ${basename(files[0]?.path ?? "file")}`;
  }

  return `Edited ${files.length} files`;
};

const buildDiffEntry = (
  id: string,
  turnId: string,
  createdAt: string,
  files: TimelineChangedFile[]
): TimelineDiffEntry | null => {
  if (files.length === 0) {
    return null;
  }

  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  const diff = files
    .map((file) => file.diff?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n\n");

  return {
    id,
    kind: "diff",
    createdAt,
    turnId,
    title: summarizeChangedFiles(files),
    diff,
    files,
    additions,
    deletions
  };
};

const projectTurn = (turn: TurnRecord, turnIndex: number): ProjectedTurn => {
  const turnId = turn.id ?? `turn-${turnIndex + 1}`;
  const createdAt = "Thread history";
  const entries: TimelineEntry[] = [];
  const diffEntries: TimelineDiffEntry[] = [];
  let latestPlan: TimelinePlan | null = null;

  for (const item of turn.items ?? []) {
    const itemId = item.id ?? `${turnId}-${randomUUID()}`;

    if (isUserMessage(item)) {
      const text = extractUserMessageText(item);

      if (text) {
        entries.push({
          id: itemId,
          kind: "message",
          role: "user",
          text,
          createdAt,
          turnId,
          summary: summarizeActivityText(text),
          isStreaming: false
        } satisfies TimelineMessageEntry);
      }

      continue;
    }

    if (isAgentMessage(item) && item.text) {
      entries.push({
        id: itemId,
        kind: "message",
        role: "assistant",
        text: item.text,
        createdAt,
        turnId,
        summary: summarizeActivityText(item.text),
        isStreaming: false
      } satisfies TimelineMessageEntry);
      continue;
    }

    if (isPlanItem(item) && item.text) {
      const plan: TimelinePlanEntry = {
        id: itemId,
        kind: "plan",
        createdAt,
        turnId,
        title: resolvePlanTitle(item.text),
        text: item.text,
        steps: []
      };
      latestPlan = {
        id: plan.id,
        createdAt: plan.createdAt,
        turnId: plan.turnId,
        title: plan.title,
        text: plan.text,
        steps: [...plan.steps]
      };
      entries.push(plan);
      continue;
    }

    if (isReasoningItem(item)) {
      const text = [...(item.summary ?? []), ...(item.content ?? [])].filter(Boolean).join("\n");

      if (text) {
        entries.push({
          id: itemId,
          kind: "work",
          createdAt,
          turnId,
          tone: "thinking",
          label: summarizeActivityText(text) || "Thinking",
          detail: text,
          command: null,
          changedFiles: []
        } satisfies TimelineWorkEntry);
      }
      continue;
    }

    if (isCommandExecutionItem(item) && item.command) {
      entries.push({
        id: itemId,
        kind: "work",
        createdAt,
        turnId,
        tone: "tool",
        label: summarizeCommand(item.command),
        detail: item.aggregatedOutput?.trim() || null,
        command: item.command,
        changedFiles: []
      } satisfies TimelineWorkEntry);
      continue;
    }

    if (isFileChangeItem(item)) {
      const changedFiles = toChangedFiles(item.changes);
      const diffEntry = buildDiffEntry(itemId, turnId, createdAt, changedFiles);

      if (diffEntry) {
        diffEntries.push(diffEntry);
        entries.push(diffEntry);
      }
    }
  }

  return {
    entries,
    latestPlan,
    diffEntries
  };
};

const trimTimelineEntries = (entries: TimelineEntry[]) =>
  entries.length > MAX_TIMELINE_ENTRIES ? entries.slice(-MAX_TIMELINE_ENTRIES) : entries;

const trimTimelineDiffs = (entries: TimelineDiffEntry[]) =>
  entries.length > MAX_TURN_DIFFS ? entries.slice(-MAX_TURN_DIFFS) : entries;

const runStateForTurnStatus = (
  status: TurnRecord["status"] | TurnRef["status"] | undefined,
  isRunning: boolean
): TimelineRunState => {
  if (isRunning) {
    return {
      phase: "running",
      label: "Working"
    };
  }

  if (status === "interrupted") {
    return {
      phase: "interrupted",
      label: "Interrupted"
    };
  }

  if (status === "failed") {
    return {
      phase: "idle",
      label: "Failed"
    };
  }

  return {
    phase: "idle",
    label: "Idle"
  };
};

export const buildTimelineState = (threadId: string, turns: TurnRecord[]): TimelineState => {
  const relevantTurns = turns.slice(-MAX_HISTORY_TURNS);
  const projected = relevantTurns.map(projectTurn);
  const entries = trimTimelineEntries(projected.flatMap((turn) => turn.entries));
  const turnDiffs = trimTimelineDiffs(projected.flatMap((turn) => turn.diffEntries));
  const latestPlan =
    [...projected]
      .reverse()
      .map((turn) => turn.latestPlan)
      .find((plan): plan is TimelinePlan => plan !== null) ?? null;
  const activeTurn = [...relevantTurns].reverse().find((turn) => turn.status === "inProgress") ?? null;
  const isRunning = Boolean(activeTurn);

  return {
    threadId,
    entries,
    activePlan: null,
    latestProposedPlan: latestPlan,
    turnDiffs,
    activeDiffPreview: turnDiffs.at(-1) ?? null,
    approvals: [],
    userInputs: [],
    isRunning,
    runState: runStateForTurnStatus(activeTurn?.status ?? relevantTurns.at(-1)?.status, isRunning)
  };
};

export const appendOptimisticUserEvent = (state: TimelineState, prompt: string): TimelineState => {
  const trimmedPrompt = prompt.trim();

  if (!trimmedPrompt) {
    return cloneTimelineState(state);
  }

  const nextState = cloneTimelineState(state);
  nextState.entries.push({
    id: `${OPTIMISTIC_USER_EVENT_PREFIX}${randomUUID()}`,
    kind: "message",
    role: "user",
    text: trimmedPrompt,
    createdAt: "Live update",
    turnId: nextState.threadId,
    summary: summarizeActivityText(trimmedPrompt),
    isStreaming: false
  });
  nextState.entries = trimTimelineEntries(nextState.entries);
  nextState.isRunning = true;
  nextState.runState = {
    phase: "starting",
    label: "Starting"
  };
  return nextState;
};

const upsertTimelineEntry = (state: TimelineState, entry: TimelineEntry) => {
  if (entry.kind === "message" && entry.role === "user") {
    const optimisticIndex = state.entries.findIndex(
      (candidate) =>
        candidate.kind === "message" &&
        candidate.role === "user" &&
        candidate.id.startsWith(OPTIMISTIC_USER_EVENT_PREFIX) &&
        candidate.text === entry.text
    );

    if (optimisticIndex >= 0) {
      state.entries[optimisticIndex] = entry;
      state.entries = trimTimelineEntries(state.entries);
      return;
    }
  }

  const existingIndex = state.entries.findIndex((candidate) => candidate.id === entry.id);

  if (existingIndex >= 0) {
    state.entries[existingIndex] = entry;
    state.entries = trimTimelineEntries(state.entries);
    return;
  }

  state.entries.push(entry);
  state.entries = trimTimelineEntries(state.entries);
};

const upsertApproval = (state: TimelineState, approval: TimelineApproval) => {
  const index = state.approvals.findIndex((entry) => entry.id === approval.id);

  if (index >= 0) {
    state.approvals[index] = approval;
    return;
  }

  state.approvals.push(approval);
};

const upsertUserInput = (state: TimelineState, request: TimelineUserInputRequest) => {
  const index = state.userInputs.findIndex((entry) => entry.id === request.id);

  if (index >= 0) {
    state.userInputs[index] = request;
    return;
  }

  state.userInputs.push(request);
};

const upsertTurnDiff = (state: TimelineState, diffEntry: TimelineDiffEntry) => {
  const index = state.turnDiffs.findIndex((entry) => entry.id === diffEntry.id);

  if (index >= 0) {
    state.turnDiffs[index] = diffEntry;
  } else {
    state.turnDiffs.push(diffEntry);
  }

  state.turnDiffs = trimTimelineDiffs(state.turnDiffs);
  state.activeDiffPreview = diffEntry;
};

const mapCommandApprovalDecisions = (value: unknown): ApprovalDecision[] => {
  const supported: ApprovalDecision[] = [];

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (
        entry === "accept" ||
        entry === "acceptForSession" ||
        entry === "decline" ||
        entry === "cancel"
      ) {
        supported.push(entry);
      }
    }
  }

  return supported.length > 0 ? supported : ["accept", "decline", "cancel"];
};

const mapUserInputOptions = (value: unknown): TimelineUserInputOption[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!isRecord(entry) || typeof entry.label !== "string") {
        return null;
      }

      return {
        label: entry.label,
        description: typeof entry.description === "string" ? entry.description : ""
      } satisfies TimelineUserInputOption;
    })
    .filter((entry): entry is TimelineUserInputOption => entry !== null);
};

const mapUserInputQuestions = (value: unknown): TimelineUserInputQuestion[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!isRecord(entry) || typeof entry.id !== "string") {
        return null;
      }

      return {
        id: entry.id,
        header: typeof entry.header === "string" ? entry.header : "Question",
        question: typeof entry.question === "string" ? entry.question : "Provide input",
        isSecret: entry.isSecret === true,
        options: mapUserInputOptions(entry.options)
      } satisfies TimelineUserInputQuestion;
    })
    .filter((entry): entry is TimelineUserInputQuestion => entry !== null);
};

const normalizeCreatedAt = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim() ? value : fallback;

const projectLiveItem = (
  item: ThreadItem,
  turnId: string,
  createdAt: string
): ProjectedTurn => {
  const projected = projectTurn(
    {
      id: turnId,
      status: "inProgress",
      items: [item]
    },
    0
  );

  return {
    entries: projected.entries.map((entry) => ({ ...entry, createdAt })),
    latestPlan: projected.latestPlan
      ? {
          ...projected.latestPlan,
          createdAt
        }
      : null,
    diffEntries: projected.diffEntries.map((entry) => ({ ...entry, createdAt }))
  };
};

export const applyBridgeNotification = async (
  currentState: TimelineState,
  payload: NotificationPayload,
  isCurrentThread: (threadId: string) => boolean,
  hydrateTimeline: (threadId: string, currentState: TimelineState) => Promise<TimelineState>
): Promise<TimelineState> => {
  const params = isRecord(payload.params) ? payload.params : {};
  const threadId = typeof params.threadId === "string" ? params.threadId : null;

  if (!threadId || !isCurrentThread(threadId)) {
    return currentState;
  }

  switch (payload.method) {
    case "turn/started": {
      const turn = isRecord(params.turn) ? (params.turn as TurnRef) : null;
      return {
        ...ensureLiveTimeline(currentState, threadId),
        isRunning: true,
        runState: {
          phase: "running",
          label: turn?.id ? "Working" : "Starting"
        }
      };
    }

    case "turn/plan/updated": {
      const nextState = ensureLiveTimeline(currentState, threadId);
      const steps = Array.isArray(params.plan)
        ? params.plan
            .map((entry) =>
              isRecord(entry) && typeof entry.step === "string"
                ? {
                    step: entry.step,
                    status:
                      entry.status === "completed" ||
                      entry.status === "in_progress" ||
                      entry.status === "pending"
                        ? entry.status
                        : "pending"
                  }
                : null
            )
            .filter((entry): entry is TimelinePlanStep => entry !== null)
        : [];
      const explanation =
        typeof params.explanation === "string" && params.explanation.trim()
          ? params.explanation.trim()
          : null;
      const turnId = typeof params.turnId === "string" ? params.turnId : null;

      nextState.activePlan = {
        id: `active-plan-${threadId}`,
        createdAt: "Live update",
        turnId,
        title: explanation ? resolvePlanTitle(explanation) : "Plan",
        text: explanation ?? "",
        steps
      };

      return nextState;
    }

    case "turn/diff/updated": {
      const nextState = ensureLiveTimeline(currentState, threadId);
      const diff = typeof params.diff === "string" ? params.diff : "";
      const turnId = typeof params.turnId === "string" ? params.turnId : null;

      nextState.activeDiffPreview = {
        id: `live-diff-${threadId}`,
        kind: "diff",
        createdAt: "Live update",
        turnId,
        title: "Live diff preview",
        diff,
        files: [],
        additions: 0,
        deletions: 0
      };

      return nextState;
    }

    case "item/started":
    case "item/completed": {
      const item = isRecord(params.item) ? (params.item as ThreadItem) : null;
      const turnId = typeof params.turnId === "string" ? params.turnId : "turn";

      if (!item) {
        return currentState;
      }

      const createdAt = normalizeCreatedAt(params.createdAt, payload.method === "item/started" ? "Live start" : "Live update");
      const projected = projectLiveItem(item, turnId, createdAt);

      if (projected.entries.length === 0 && !projected.latestPlan && projected.diffEntries.length === 0) {
        return currentState;
      }

      const nextState = ensureLiveTimeline(currentState, threadId);

      for (const entry of projected.entries) {
        upsertTimelineEntry(nextState, entry);
      }

      if (projected.latestPlan) {
        nextState.latestProposedPlan = projected.latestPlan;
      }

      for (const diffEntry of projected.diffEntries) {
        upsertTurnDiff(nextState, diffEntry);
      }

      return nextState;
    }

    case "item/agentMessage/delta": {
      const itemId = typeof params.itemId === "string" ? params.itemId : randomUUID();
      const delta = typeof params.delta === "string" ? params.delta : "";
      const turnId = typeof params.turnId === "string" ? params.turnId : null;

      if (!delta) {
        return currentState;
      }

      const nextState = ensureLiveTimeline(currentState, threadId);
      const existingIndex = nextState.entries.findIndex((entry) => entry.id === itemId);

      if (existingIndex >= 0 && nextState.entries[existingIndex]?.kind === "message") {
        const existing = nextState.entries[existingIndex] as TimelineMessageEntry;
        nextState.entries[existingIndex] = {
          ...existing,
          role: "assistant",
          text: `${existing.text}${delta}`,
          summary: summarizeActivityText(`${existing.text}${delta}`),
          createdAt: "Streaming",
          turnId,
          isStreaming: true
        };
      } else {
        nextState.entries.push({
          id: itemId,
          kind: "message",
          role: "assistant",
          text: delta,
          createdAt: "Streaming",
          turnId,
          summary: summarizeActivityText(delta),
          isStreaming: true
        });
      }

      nextState.entries = trimTimelineEntries(nextState.entries);
      return nextState;
    }

    case "serverRequest/resolved": {
      const requestId = typeof params.requestId === "string" ? params.requestId : null;

      if (!requestId) {
        return currentState;
      }

      const nextState = ensureLiveTimeline(currentState, threadId);
      nextState.approvals = nextState.approvals.filter((approval) => approval.id !== requestId);
      nextState.userInputs = nextState.userInputs.filter((request) => request.id !== requestId);
      return nextState;
    }

    case "turn/completed": {
      const turn = isRecord(params.turn) ? (params.turn as TurnRef) : null;

      return hydrateTimeline(threadId, {
        ...ensureLiveTimeline(currentState, threadId),
        isRunning: false,
        runState: runStateForTurnStatus(turn?.status, false)
      });
    }

    default:
      return currentState;
  }
};

export const applyBridgeRequest = (
  currentState: TimelineState,
  payload: RequestPayload,
  isCurrentThread: (threadId: string) => boolean
): TimelineState => {
  const params = isRecord(payload.params) ? payload.params : {};
  const threadId = typeof params.threadId === "string" ? params.threadId : null;

  if (!threadId || !isCurrentThread(threadId)) {
    return currentState;
  }

  const nextState = ensureLiveTimeline(currentState, threadId);

  if (payload.method === "item/commandExecution/requestApproval") {
    const command = typeof params.command === "string" ? params.command.trim() : "";
    const cwd = typeof params.cwd === "string" ? params.cwd.trim() : "";
    const reason = typeof params.reason === "string" ? params.reason.trim() : "";

    upsertApproval(nextState, {
      id: payload.id,
      kind: "command",
      title: command ? `Run command: ${command}` : "Run command",
      detail: [cwd ? `cwd: ${cwd}` : null, reason || null].filter(Boolean).join("\n"),
      availableDecisions: mapCommandApprovalDecisions(params.availableDecisions),
      isSubmitting: false
    });
  }

  if (payload.method === "item/fileChange/requestApproval") {
    const reason = typeof params.reason === "string" ? params.reason.trim() : "";
    const grantRoot = typeof params.grantRoot === "string" ? params.grantRoot.trim() : "";

    upsertApproval(nextState, {
      id: payload.id,
      kind: "fileChange",
      title: "Apply file changes",
      detail: [reason || null, grantRoot ? `grant root: ${grantRoot}` : null]
        .filter(Boolean)
        .join("\n"),
      availableDecisions: grantRoot
        ? ["accept", "acceptForSession", "decline", "cancel"]
        : ["accept", "decline", "cancel"],
      isSubmitting: false
    });
  }

  if (payload.method === "item/tool/requestUserInput") {
    upsertUserInput(nextState, {
      id: payload.id,
      title: "Clarification requested",
      questions: mapUserInputQuestions(params.questions),
      isSubmitting: false
    });
  }

  return nextState;
};
