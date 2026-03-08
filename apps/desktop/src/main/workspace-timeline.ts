import { randomUUID } from "node:crypto";
import type {
  ApprovalDecision,
  TimelineApproval,
  TimelineEvent,
  TimelinePlanStep,
  TimelineState,
  TimelineUserInputOption,
  TimelineUserInputQuestion,
  TimelineUserInputRequest
} from "@shared";

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
      changes?: Array<{ path?: string }>;
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

const isUserMessage = (item: ThreadItem): item is UserMessageItem => item.type === "userMessage";
const isAgentMessage = (item: ThreadItem): item is AgentMessageItem => item.type === "agentMessage";
const isPlanItem = (item: ThreadItem): item is PlanItem => item.type === "plan";
const isReasoningItem = (item: ThreadItem): item is ReasoningItem => item.type === "reasoning";
const isCommandExecutionItem = (item: ThreadItem): item is CommandExecutionItem =>
  item.type === "commandExecution";
const isFileChangeItem = (item: ThreadItem): item is FileChangeItem => item.type === "fileChange";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

export const emptyTimelineState = (threadId: string | null = null): TimelineState => ({
  threadId,
  events: [],
  planSteps: [],
  diff: "",
  approvals: [],
  userInputs: [],
  isRunning: false,
  statusLabel: null
});

export const cloneTimelineState = (state: TimelineState): TimelineState => ({
  ...state,
  events: [...state.events],
  planSteps: [...state.planSteps],
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
  }))
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

export const buildTimelineState = (threadId: string, turns: TurnRecord[]): TimelineState => {
  const events = turns.flatMap((turn) =>
    (turn.items ?? [])
      .map((item) => toTimelineEvent(item, turn.id ?? "turn"))
      .filter((event): event is TimelineEvent => event !== null)
  );
  const activeTurn = turns.find((turn) => turn.status === "inProgress") ?? null;

  return {
    threadId,
    events,
    planSteps: [],
    diff: "",
    approvals: [],
    userInputs: [],
    isRunning: Boolean(activeTurn),
    statusLabel: activeTurn ? "Working" : turns.at(-1)?.status ?? "Idle"
  };
};

export const applyBridgeNotification = async (
  currentState: TimelineState,
  payload: NotificationPayload,
  isCurrentThread: (threadId: string) => boolean,
  hydrateTimeline: (threadId: string, currentState: TimelineState) => Promise<TimelineState>
) => {
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
        statusLabel: turn?.id ? "Working" : "Starting"
      };
    }

    case "turn/plan/updated": {
      const nextState = ensureLiveTimeline(currentState, threadId);
      nextState.planSteps = Array.isArray(params.plan)
        ? params.plan
            .map((entry) =>
              isRecord(entry) && typeof entry.step === "string"
                ? {
                    step: entry.step,
                    status: typeof entry.status === "string" ? entry.status : "pending"
                  }
                : null
            )
            .filter((entry): entry is TimelinePlanStep => entry !== null)
        : [];

      const explanation =
        typeof params.explanation === "string" ? params.explanation.trim() : "";

      if (explanation) {
        upsertTimelineEvent(nextState, {
          id: `plan-${threadId}`,
          kind: "commentary",
          text: explanation,
          createdAt: "Live update"
        });
      }

      return nextState;
    }

    case "turn/diff/updated":
      return {
        ...ensureLiveTimeline(currentState, threadId),
        diff: typeof params.diff === "string" ? params.diff : ""
      };

    case "item/started":
    case "item/completed": {
      const item = isRecord(params.item) ? (params.item as ThreadItem) : null;
      const turnId = typeof params.turnId === "string" ? params.turnId : "turn";

      if (!item) {
        return currentState;
      }

      const event = toTimelineEvent(item, turnId);

      if (!event) {
        return currentState;
      }

      const nextState = ensureLiveTimeline(currentState, threadId);
      upsertTimelineEvent(nextState, {
        ...event,
        createdAt: payload.method === "item/started" ? "Live start" : "Live update"
      });
      return nextState;
    }

    case "item/agentMessage/delta": {
      const itemId = typeof params.itemId === "string" ? params.itemId : randomUUID();
      const delta = typeof params.delta === "string" ? params.delta : "";

      if (!delta) {
        return currentState;
      }

      const nextState = ensureLiveTimeline(currentState, threadId);
      const existingIndex = nextState.events.findIndex((event) => event.id === itemId);

      if (existingIndex >= 0) {
        const existing = nextState.events[existingIndex];
        nextState.events[existingIndex] = {
          ...existing,
          text: `${existing.text}${delta}`,
          createdAt: "Streaming"
        };
      } else {
        nextState.events.push({
          id: itemId,
          kind: "assistant",
          text: delta,
          createdAt: "Streaming"
        });
      }

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
        statusLabel: turn?.status ?? "completed"
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
) => {
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

const toTimelineEvent = (item: ThreadItem, turnId: string): TimelineEvent | null => {
  const base = {
    id: item.id ?? `${turnId}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: "Thread history"
  };

  if (isUserMessage(item)) {
    const text = (item.content ?? [])
      .filter((entry): entry is { type: "text"; text: string } =>
        entry.type === "text" && typeof entry.text === "string"
      )
      .map((entry) => entry.text.trim())
      .filter(Boolean)
      .join("\n");

    return text ? { ...base, kind: "user", text } : null;
  }

  if (isAgentMessage(item) && item.text) {
    return {
      ...base,
      kind: "assistant",
      text: item.text
    };
  }

  if (isPlanItem(item) && item.text) {
    return {
      ...base,
      kind: "commentary",
      text: `Plan update: ${item.text}`
    };
  }

  if (isReasoningItem(item)) {
    const text = [...(item.summary ?? []), ...(item.content ?? [])].filter(Boolean).join("\n");
    return text ? { ...base, kind: "commentary", text } : null;
  }

  if (isCommandExecutionItem(item) && item.command) {
    return {
      ...base,
      kind: "system",
      text: `Command: ${item.command}${item.aggregatedOutput ? `\n${item.aggregatedOutput}` : ""}`
    };
  }

  if (isFileChangeItem(item)) {
    return {
      ...base,
      kind: "system",
      text: `File changes proposed: ${item.changes?.length ?? 0}`
    };
  }

  return null;
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

const upsertTimelineEvent = (state: TimelineState, event: TimelineEvent) => {
  const index = state.events.findIndex((entry) => entry.id === event.id);

  if (index >= 0) {
    state.events[index] = event;
    return;
  }

  state.events.push(event);
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
