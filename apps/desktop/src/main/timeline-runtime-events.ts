import { randomUUID } from "node:crypto";
import {
  normalizeProviderRuntimeNotification as parseProviderRuntimeNotification,
  normalizeProviderRuntimeRequest as parseProviderRuntimeRequest
} from "@codex-realtime/contracts";
import type {
  ProviderRuntimeActivityEvent,
  ProviderRuntimeActivityItem,
  ProviderRuntimeApprovalRequestEvent,
  ProviderRuntimeAudioInputEvent,
  ProviderRuntimeAudioOutputEvent,
  ProviderRuntimeErrorEvent,
  ProviderRuntimeInterruptionEvent,
  ProviderRuntimeMessageItem,
  ProviderRuntimeProgressStatus,
  ProviderRuntimeRequestResolvedEvent,
  ProviderRuntimeSessionLifecycleEvent,
  ProviderRuntimeTaskEvent,
  ProviderRuntimeThreadEvent,
  ProviderRuntimeTimelineItem,
  ProviderRuntimeToolCallEvent,
  ProviderRuntimeUsageEvent,
  ProviderRuntimeUserInputRequestEvent
} from "@codex-realtime/contracts";
import type {
  ApprovalDecision,
  TimelineActivityEntry,
  TimelineActivityStatus,
  TimelineActivityType,
  TimelineApproval,
  TimelineChangedFile,
  TimelineDiffEntry,
  TimelineEntry,
  TimelineMessageEntry,
  TimelinePlan,
  TimelinePlanStep,
  TimelineRunState,
  TimelineTurn,
  TimelineUserInputQuestion,
  TimelineUserInputRequest
} from "@shared";
import { countDiffStats } from "./diff-stats";
import { summarizeActivityText, summarizeCommand } from "./timeline-event-summary";

export type ThreadItem = Record<string, unknown> & {
  type?: string;
  id?: string;
};

export type TurnRecord = {
  id?: string;
  status?: "completed" | "interrupted" | "failed" | "inProgress";
  items?: ThreadItem[];
  startedAt?: string;
  completedAt?: string;
  createdAt?: string;
};

export type TurnRef = {
  id?: string;
  status?: "completed" | "interrupted" | "failed" | "inProgress";
  startedAt?: string;
  completedAt?: string;
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

export type TimelineRuntimeMutation =
  | { type: "upsertEntry"; entry: TimelineEntry }
  | { type: "appendAssistantDelta"; id: string; turnId: string | null; delta: string; createdAt: string }
  | { type: "setActivePlan"; plan: TimelinePlan | null }
  | { type: "upsertLatestProposedPlan"; plan: TimelinePlan; merge: "replace" | "append" }
  | { type: "upsertTurnDiff"; diff: TimelineDiffEntry }
  | { type: "setActiveDiffPreview"; diff: TimelineDiffEntry | null }
  | { type: "upsertApproval"; approval: TimelineApproval }
  | { type: "upsertUserInput"; request: TimelineUserInputRequest }
  | { type: "resolveRequest"; requestId: string }
  | {
      type: "setRunState";
      runState: TimelineRunState;
      isRunning: boolean;
      latestTurn: TimelineTurn | null;
      activeWorkStartedAt: string | null;
    };

type ProjectedTurn = {
  entries: TimelineEntry[];
  latestProposedPlan: TimelinePlan | null;
  diffEntries: TimelineDiffEntry[];
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

const asString = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

const toCanonicalToken = (value: string | null | undefined) =>
  value
    ? value
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/[.\-/\s]+/g, "_")
        .replace(/__+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase()
    : null;

const formatTokenLabel = (value: string) =>
  value
    .split("_")
    .filter(Boolean)
    .map((segment) =>
      segment.length <= 3 ? segment.toUpperCase() : `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`
    )
    .join(" ");

const collectTextParts = (value: unknown): string[] => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectTextParts(entry));
  }

  if (!isRecord(value)) {
    return [];
  }

  return [
    ...collectTextParts(value.text),
    ...collectTextParts(value.detail),
    ...collectTextParts(value.message),
    ...collectTextParts(value.reason),
    ...collectTextParts(value.summary),
    ...collectTextParts(value.content),
    ...collectTextParts(value.output)
  ];
};

const collectJoinedText = (...values: unknown[]) => {
  const seen = new Set<string>();
  const parts = values.flatMap((value) => collectTextParts(value)).filter((part) => {
    if (!part || seen.has(part)) {
      return false;
    }

    seen.add(part);
    return true;
  });

  return parts.length > 0 ? parts.join("\n") : null;
};

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const normalizeCommandValue = (value: unknown): string | null => {
  const direct = asString(value);

  if (direct) {
    return normalizeWhitespace(direct);
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const parts = value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => entry !== null)
    .map(normalizeWhitespace)
    .filter(Boolean);

  return parts.length > 0 ? parts.join(" ") : null;
};

const normalizeTimestamp = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim() ? value : fallback;

const buildChangedFile = (change: unknown): TimelineChangedFile | null => {
  if (!isRecord(change)) {
    return null;
  }

  const path =
    asString(change.path) ??
    asString(change.filePath) ??
    asString(change.relativePath) ??
    asString(change.newPath) ??
    asString(change.oldPath);

  if (!path) {
    return null;
  }

  const diff = asString(change.diff);
  const stats = diff ? countDiffStats(diff) : { additions: 0, deletions: 0 };

  return {
    path,
    additions: stats.additions,
    deletions: stats.deletions,
    diff: diff ?? null
  };
};

const collectChangedFiles = (value: unknown, seen = new Set<string>()): TimelineChangedFile[] => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectChangedFiles(entry, seen)).slice(0, 24);
  }

  if (!isRecord(value)) {
    return [];
  }

  const direct = buildChangedFile(value);
  const nextFiles: TimelineChangedFile[] = [];

  if (direct && !seen.has(direct.path)) {
    seen.add(direct.path);
    nextFiles.push(direct);
  }

  for (const key of ["changes", "files", "results", "data", "output", "edits", "patches"]) {
    if (!(key in value)) {
      continue;
    }

    for (const nested of collectChangedFiles(value[key], seen)) {
      if (nextFiles.length >= 24) {
        break;
      }
      nextFiles.push(nested);
    }
  }

  return nextFiles.slice(0, 24);
};

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

const resolveActivityType = (type: string | null): TimelineActivityType => {
  switch (toCanonicalToken(type)) {
    case "reasoning":
      return "reasoning";
    case "command_execution":
      return "command_execution";
    case "mcp_tool_call":
      return "mcp_tool_call";
    case "dynamic_tool_call":
      return "dynamic_tool_call";
    case "collab_agent_tool_call":
      return "collab_agent_tool_call";
    case "web_search":
      return "web_search";
    case "image_view":
      return "image_view";
    case "plan_update":
      return "plan_update";
    case "review_entered":
      return "review_entered";
    case "review_exited":
      return "review_exited";
    case "context_compaction":
      return "context_compaction";
    case "error":
    case "runtime_error":
      return "error";
    default:
      return "unknown";
  }
};

const resolveActivityTone = (activityType: TimelineActivityType): TimelineActivityEntry["tone"] => {
  switch (activityType) {
    case "reasoning":
      return "thinking";
    case "error":
      return "error";
    case "command_execution":
    case "mcp_tool_call":
    case "dynamic_tool_call":
    case "collab_agent_tool_call":
    case "web_search":
    case "image_view":
      return "tool";
    default:
      return "info";
  }
};

const resolveActivityStatus = (
  value: unknown,
  fallback: TimelineActivityStatus = null
): TimelineActivityStatus => {
  switch (value) {
    case "inProgress":
    case "in_progress":
    case "started":
    case "running":
      return "in_progress";
    case "completed":
    case "done":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    case "declined":
    case "cancelled":
    case "canceled":
      return "declined";
    default:
      return fallback;
  }
};

const buildActivityEntry = (item: ThreadItem, turnId: string, createdAt: string): TimelineActivityEntry => {
  const rawType = asString(item.type);
  const activityType = resolveActivityType(rawType);
  const command =
    normalizeCommandValue(item.command) ??
    normalizeCommandValue(item.args) ??
    normalizeCommandValue(item.invocation);
  const detail =
    collectJoinedText(
      item.detail,
      item.aggregatedOutput,
      item.output,
      item.text,
      item.reason,
      item.summary,
      item.content
    ) ??
    null;
  const toolName = asString(item.toolName) ?? asString(item.name) ?? asString(item.title) ?? null;
  const agentLabel =
    asString(item.agentLabel) ?? asString(item.agentName) ?? asString(item.agent) ?? null;
  const changedFiles = collectChangedFiles(item.changes ?? item.files ?? item.data ?? item.output);
  const baseLabel =
    asString(item.label) ??
    collectJoinedText(item.summary)?.split("\n").find(Boolean) ??
    (command ? summarizeCommand(command) : null) ??
    (detail ? summarizeActivityText(detail) : null) ??
    toolName ??
    (rawType ? formatTokenLabel(toCanonicalToken(rawType) ?? rawType) : null) ??
    "Activity";

  return {
    id: asString(item.id) ?? `${turnId}-${rawType ?? "activity"}-${randomUUID()}`,
    kind: "activity",
    activityType,
    createdAt,
    turnId,
    tone: resolveActivityTone(activityType),
    label: baseLabel,
    detail,
    command,
    changedFiles,
    status: resolveActivityStatus(item.status),
    toolName,
    agentLabel
  };
};

const extractMessageText = (item: ThreadItem) => collectJoinedText(item.content, item.text) ?? "";

const buildMessageEntry = (
  role: "user" | "assistant",
  item: ThreadItem,
  turnId: string,
  createdAt: string
): TimelineMessageEntry | null => {
  const text = extractMessageText(item).trim();

  if (!text) {
    return null;
  }

  return {
    id: asString(item.id) ?? `${turnId}-${role}-message-${randomUUID()}`,
    kind: "message",
    role,
    text,
    createdAt,
    completedAt: asString(item.completedAt),
    turnId,
    summary: summarizeActivityText(text),
    isStreaming: false,
    providerLabel: asString(item.providerLabel)
  };
};

const buildProposedPlanEntry = (
  itemId: string,
  turnId: string | null,
  text: string,
  createdAt: string,
  updatedAt: string | null = null
): TimelinePlan => ({
  id: itemId,
  createdAt,
  updatedAt,
  turnId,
  title: resolvePlanTitle(text),
  text,
  steps: []
});

const buildDiffEntry = (
  id: string,
  turnId: string | null,
  createdAt: string,
  files: TimelineChangedFile[],
  assistantMessageId: string | null,
  title?: string | null,
  diff?: string | null
): TimelineDiffEntry | null => {
  if (files.length === 0 && !diff?.trim()) {
    return null;
  }

  const mergedDiff =
    diff?.trim() ??
    files
      .map((file) => file.diff?.trim())
      .filter((entry): entry is string => Boolean(entry))
      .join("\n\n");
  const totals = files.reduce(
    (result, file) => ({
      additions: result.additions + file.additions,
      deletions: result.deletions + file.deletions
    }),
    { additions: 0, deletions: 0 }
  );

  return {
    id,
    kind: "diffSummary",
    createdAt,
    turnId,
    assistantMessageId,
    title: title ?? (files.length === 1 ? `Changed ${files[0]?.path ?? "file"}` : `Changed ${files.length} files`),
    diff: mergedDiff,
    files,
    additions: totals.additions,
    deletions: totals.deletions
  };
};

const buildCanonicalMessageEntry = (
  item: ProviderRuntimeMessageItem,
  turnId: string,
  createdAt: string
): TimelineMessageEntry | null => {
  const text = item.text.trim();

  if (!text) {
    return null;
  }

  return {
    id: item.id ?? `${turnId}-${item.role}-message-${randomUUID()}`,
    kind: "message",
    role: item.role,
    text,
    createdAt,
    completedAt: item.completedAt,
    turnId,
    summary: summarizeActivityText(text),
    isStreaming: false,
    providerLabel: item.providerLabel
  };
};

const buildCanonicalActivityEntry = (
  item: ProviderRuntimeActivityItem,
  turnId: string,
  createdAt: string
): TimelineActivityEntry => {
  const activityType = resolveActivityType(item.activityType);
  const label =
    item.label ??
    (item.command ? summarizeCommand(item.command) : null) ??
    (item.detail ? summarizeActivityText(item.detail) : null) ??
    item.toolName ??
    "Activity";

  return {
    id: item.id ?? `${turnId}-${item.sourceType ?? item.activityType}-${randomUUID()}`,
    kind: "activity",
    activityType,
    createdAt,
    turnId,
    tone: resolveActivityTone(activityType),
    label,
    detail: item.detail,
    command: item.command,
    changedFiles: item.changedFiles,
    status: resolveActivityStatus(item.status),
    toolName: item.toolName,
    agentLabel: item.agentLabel
  };
};

const buildTimelineActivityMutation = (args: {
  id?: string | null;
  activityType: string | null;
  createdAt: string;
  turnId: string | null;
  label?: string | null;
  detail?: string | null;
  command?: string | null;
  changedFiles?: TimelineChangedFile[];
  status?: ProviderRuntimeProgressStatus | TimelineActivityStatus;
  toolName?: string | null;
  agentLabel?: string | null;
}): TimelineRuntimeMutation => {
  const activityType = resolveActivityType(args.activityType);

  return {
    type: "upsertEntry",
    entry: {
      id: args.id ?? `${args.turnId ?? "thread"}-${args.activityType ?? "activity"}-${randomUUID()}`,
      kind: "activity",
      activityType,
      createdAt: args.createdAt,
      turnId: args.turnId,
      tone: resolveActivityTone(activityType),
      label: args.label ?? formatTokenLabel(args.activityType ?? "activity"),
      detail: args.detail ?? null,
      command: args.command ?? null,
      changedFiles: args.changedFiles ?? [],
      status: resolveActivityStatus(args.status),
      toolName: args.toolName ?? null,
      agentLabel: args.agentLabel ?? null
    }
  };
};

const buildApprovalMutationFromEvent = (
  event: ProviderRuntimeApprovalRequestEvent
): TimelineRuntimeMutation | null => {
  switch (event.requestType) {
    case "command_execution_approval":
    case "exec_command_approval":
      return {
        type: "upsertApproval",
        approval: {
          id: event.requestId,
          kind: "command",
          title: event.command ? `Run command: ${event.command}` : "Run command",
          detail: [event.cwd ? `cwd: ${event.cwd}` : null, event.reason].filter(Boolean).join("\n"),
          availableDecisions: event.availableDecisions as ApprovalDecision[],
          isSubmitting: false
        }
      };
    case "file_change_approval":
    case "apply_patch_approval":
    case "file_read_approval":
      return {
        type: "upsertApproval",
        approval: {
          id: event.requestId,
          kind: "fileChange",
          title: event.requestType === "file_read_approval" ? "Read file" : "Apply file changes",
          detail: [event.reason, event.grantRoot ? `path: ${event.grantRoot}` : null].filter(Boolean).join("\n"),
          availableDecisions:
            event.requestType !== "file_read_approval" && event.grantRoot
              ? ["accept", "acceptForSession", "decline", "cancel"]
              : ["accept", "decline", "cancel"],
          isSubmitting: false
        }
      };
    default:
      return null;
  }
};

const buildUserInputMutationFromEvent = (
  event: ProviderRuntimeUserInputRequestEvent
): TimelineRuntimeMutation => ({
  type: "upsertUserInput",
  request: {
    id: event.requestId,
    title: event.title ?? "Clarification requested",
    questions: event.questions as TimelineUserInputQuestion[],
    isSubmitting: false
  }
});

const projectCanonicalRuntimeItem = (
  item: ProviderRuntimeTimelineItem,
  turnId: string,
  createdAt: string
): TimelineRuntimeMutation[] => {
  switch (item.kind) {
    case "message": {
      const message = buildCanonicalMessageEntry(item, turnId, createdAt);
      return message ? [{ type: "upsertEntry", entry: message }] : [];
    }
    case "activity":
      return [{ type: "upsertEntry", entry: buildCanonicalActivityEntry(item, turnId, createdAt) }];
    case "plan":
      return [
        {
          type: "upsertLatestProposedPlan",
          plan: buildProposedPlanEntry(
            item.id ?? `${turnId}-proposed-plan`,
            turnId,
            item.text,
            createdAt,
            item.updatedAt ?? item.completedAt ?? createdAt
          ),
          merge: "replace"
        }
      ];
    case "file_change": {
      const diff = buildDiffEntry(
        item.id ?? `${turnId}-diff-${randomUUID()}`,
        turnId,
        createdAt,
        item.files,
        null,
        item.title,
        item.diff
      );

      return diff ? [{ type: "upsertTurnDiff", diff }] : [];
    }
  }

  return [];
};

export const projectTurnRecord = (turn: TurnRecord, index: number): ProjectedTurn => {
  const turnId = turn.id ?? `turn-${index + 1}`;
  const createdAt = normalizeTimestamp(turn.startedAt ?? turn.createdAt, "Thread history");
  const entries: TimelineEntry[] = [];
  const diffEntries: TimelineDiffEntry[] = [];
  let latestProposedPlan: TimelinePlan | null = null;
  let lastAssistantMessageId: string | null = null;

  for (const item of turn.items ?? []) {
    const itemCreatedAt = normalizeTimestamp(item.createdAt, createdAt);
    const rawType = asString(item.type);

    if (rawType === "userMessage") {
      const message = buildMessageEntry("user", item, turnId, itemCreatedAt);

      if (message) {
        entries.push(message);
      }

      continue;
    }

    if (rawType === "agentMessage") {
      const message = buildMessageEntry("assistant", item, turnId, itemCreatedAt);

      if (message) {
        lastAssistantMessageId = message.id;
        entries.push(message);
      }

      continue;
    }

    if (rawType === "plan") {
      const text = extractMessageText(item).trim();

      if (!text) {
        continue;
      }

      latestProposedPlan = buildProposedPlanEntry(
        asString(item.id) ?? `${turnId}-proposed-plan`,
        turnId,
        text,
        itemCreatedAt,
        asString(item.updatedAt) ?? asString(item.completedAt) ?? itemCreatedAt
      );
      entries.push({
        ...latestProposedPlan,
        kind: "proposedPlan"
      });
      continue;
    }

    if (rawType === "fileChange") {
      const diffEntry = buildDiffEntry(
        asString(item.id) ?? `${turnId}-diff-${randomUUID()}`,
        turnId,
        itemCreatedAt,
        collectChangedFiles(item.changes),
        lastAssistantMessageId
      );

      if (diffEntry) {
        diffEntries.push(diffEntry);
        entries.push(diffEntry);
      }
      continue;
    }

    entries.push(buildActivityEntry(item, turnId, itemCreatedAt));
  }

  return { entries, latestProposedPlan, diffEntries };
};

type RuntimeActivityEvent =
  | ProviderRuntimeActivityEvent
  | ProviderRuntimeAudioInputEvent
  | ProviderRuntimeAudioOutputEvent
  | ProviderRuntimeErrorEvent
  | ProviderRuntimeInterruptionEvent
  | ProviderRuntimeSessionLifecycleEvent
  | ProviderRuntimeTaskEvent
  | ProviderRuntimeThreadEvent
  | ProviderRuntimeToolCallEvent
  | ProviderRuntimeUsageEvent;

const pushRequestEventMutations = (
  event:
    | ProviderRuntimeApprovalRequestEvent
    | ProviderRuntimeRequestResolvedEvent
    | ProviderRuntimeUserInputRequestEvent,
  mutations: TimelineRuntimeMutation[]
) => {
  if (event.kind === "approval.requested") {
    const mutation = buildApprovalMutationFromEvent(event);

    if (mutation) {
      mutations.push(mutation);
    }

    return;
  }

  if (event.kind === "user_input.requested") {
    mutations.push(buildUserInputMutationFromEvent(event));
    return;
  }

  mutations.push({ type: "resolveRequest", requestId: event.requestId });
};

const resolveRuntimeActivityLabel = (event: RuntimeActivityEvent) => {
  switch (event.kind) {
    case "tool.call":
      return event.label ?? event.toolName ?? "Tool update";
    case "task":
      return event.label ?? formatTokenLabel(event.sourceMethod);
    case "session.lifecycle":
      return event.state ? `Session ${event.state}` : "Session updated";
    case "thread":
      return event.title ?? formatTokenLabel(event.sourceMethod);
    case "audio.input":
      return `Audio input ${formatTokenLabel(event.phase)}`;
    case "audio.output":
      return `Audio output ${formatTokenLabel(event.phase)}`;
    case "interruption":
      return "Interrupted";
    case "usage":
      return "Usage updated";
    case "error":
      return event.message;
    case "activity":
      return event.label ?? formatTokenLabel(event.sourceMethod);
  }
};

const resolveRuntimeActivityDetail = (event: RuntimeActivityEvent) => {
  switch (event.kind) {
    case "audio.input":
    case "audio.output":
      return event.transcript ?? event.delta;
    case "interruption":
      return event.reason;
    case "usage":
      return Object.entries(event.usage)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n");
    case "error":
      return event.detail;
    case "session.lifecycle":
      return event.error ?? event.detail;
    default:
      return event.detail;
  }
};

const resolveRuntimeActivityTypeKey = (event: RuntimeActivityEvent) => {
  switch (event.kind) {
    case "tool.call":
      return "dynamic_tool_call";
    case "task":
      return event.command ? "command_execution" : event.sourceMethod;
    case "error":
      return "error";
    case "activity":
      return event.activityType;
    default:
      return event.sourceMethod;
  }
};

const resolveRuntimeActivityChangedFiles = (event: RuntimeActivityEvent): TimelineChangedFile[] => {
  switch (event.kind) {
    case "tool.call":
    case "task":
    case "thread":
    case "activity":
      return event.files;
    default:
      return [];
  }
};

const resolveRuntimeActivityStatusValue = (event: RuntimeActivityEvent) => {
  switch (event.kind) {
    case "tool.call":
    case "task":
    case "activity":
      return event.status;
    default:
      return null;
  }
};

const resolveRuntimeActivityToolName = (event: RuntimeActivityEvent) => {
  switch (event.kind) {
    case "tool.call":
    case "task":
    case "activity":
      return event.toolName;
    default:
      return null;
  }
};

const resolveRuntimeActivityAgentLabel = (event: RuntimeActivityEvent) => {
  switch (event.kind) {
    case "tool.call":
    case "task":
    case "activity":
      return event.agentLabel;
    default:
      return null;
  }
};

const resolveRuntimeActivityCommand = (event: RuntimeActivityEvent) => {
  switch (event.kind) {
    case "tool.call":
    case "task":
    case "activity":
      return event.command;
    default:
      return null;
  }
};

const resolveRuntimeActivityId = (event: RuntimeActivityEvent) => {
  switch (event.kind) {
    case "tool.call":
    case "task":
    case "activity":
    case "error":
    case "audio.input":
    case "audio.output":
    case "interruption":
      return event.itemId;
    default:
      return null;
  }
};

const buildRuntimeActivityMutationFromEvent = (
  event: RuntimeActivityEvent,
  createdAt: string
): TimelineRuntimeMutation =>
  buildTimelineActivityMutation({
    id: resolveRuntimeActivityId(event),
    activityType: resolveRuntimeActivityTypeKey(event),
    createdAt,
    turnId: event.turnId,
    label: resolveRuntimeActivityLabel(event),
    detail: resolveRuntimeActivityDetail(event),
    command: resolveRuntimeActivityCommand(event),
    changedFiles: resolveRuntimeActivityChangedFiles(event),
    status: resolveRuntimeActivityStatusValue(event),
    toolName: resolveRuntimeActivityToolName(event),
    agentLabel: resolveRuntimeActivityAgentLabel(event)
  });

export const normalizeBridgeRequest = (payload: RequestPayload) => {
  const event = parseProviderRuntimeRequest(payload);
  const mutations: TimelineRuntimeMutation[] = [];

  if (!event) {
    return { threadId: null, mutations };
  }

  if (
    event.kind === "approval.requested" ||
    event.kind === "user_input.requested" ||
    event.kind === "request.resolved"
  ) {
    pushRequestEventMutations(event, mutations);
  }

  return { threadId: event.threadId, mutations };
};

export const normalizeBridgeNotification = (payload: NotificationPayload) => {
  const event = parseProviderRuntimeNotification(payload);
  const mutations: TimelineRuntimeMutation[] = [];

  if (!event) {
    return { threadId: null, sequence: null, mutations };
  }

  const threadId = event.threadId;
  const turnId = event.turnId;
  const createdAt = normalizeTimestamp(event.createdAt, "Live update");

  if (event.kind === "turn.lifecycle") {
    const latestTurn: TimelineTurn | null =
      turnId || event.turn?.id
        ? {
            id: turnId ?? event.turn?.id ?? randomUUID(),
            status: event.turn?.status ?? "inProgress",
            startedAt: event.turn?.startedAt ?? createdAt,
            completedAt: event.turn?.completedAt ?? null
          }
        : null;

    if (event.phase === "started") {
      mutations.push({
        type: "setRunState",
        runState: { phase: "running", label: "Working" },
        isRunning: true,
        latestTurn,
        activeWorkStartedAt: createdAt
      });
    } else {
      const interrupted =
        event.phase === "aborted" ||
        event.turn?.status === "interrupted" ||
        event.reason === "interrupted";
      const phase =
        event.turn?.status === "failed" ? "failed" : interrupted ? "interrupted" : "idle";
      const label = phase === "failed" ? "Failed" : phase === "interrupted" ? "Interrupted" : "Idle";

      mutations.push({
        type: "setRunState",
        runState: { phase, label },
        isRunning: false,
        latestTurn,
        activeWorkStartedAt: null
      });
    }
  }

  if (event.kind === "turn.plan") {
    if (event.planKind === "active") {
      mutations.push({
        type: "setActivePlan",
        plan:
          event.steps.length > 0 || event.text
            ? {
                id: `active-plan-${threadId ?? "thread"}`,
                createdAt,
                updatedAt: createdAt,
                turnId,
                title: event.text ? resolvePlanTitle(event.text) : "Plan",
                text: event.text,
                steps: event.steps as TimelinePlanStep[]
              }
            : null
      });
      mutations.push(
        buildTimelineActivityMutation({
          activityType: "plan_update",
          createdAt,
          turnId,
          label: "Plan updated",
          detail: event.explanation ?? event.text
        })
      );
    } else if (event.text) {
      mutations.push({
        type: "upsertLatestProposedPlan",
        merge: event.merge,
        plan: buildProposedPlanEntry(
          event.planId ?? `${turnId ?? threadId ?? "thread"}-proposed-plan`,
          turnId,
          event.text,
          createdAt,
          createdAt
        )
      });
    }
  }

  if (event.kind === "turn.diff") {
    mutations.push({
      type: "setActiveDiffPreview",
      diff: buildDiffEntry(
        event.diffId ?? `live-diff-${turnId ?? threadId ?? randomUUID()}`,
        turnId,
        createdAt,
        event.files,
        event.assistantMessageId,
        event.title ?? "Live diff preview",
        event.diff
      )
    });
  }

  if (event.kind === "message.delta") {
    mutations.push({
      type: "appendAssistantDelta",
      id: event.itemId ?? randomUUID(),
      turnId,
      delta: event.delta,
      createdAt
    });
  }

  if (event.kind === "item.lifecycle") {
    const projectedTurnId = turnId ?? event.item.id ?? randomUUID();

    for (const mutation of projectCanonicalRuntimeItem(event.item, projectedTurnId, createdAt)) {
      mutations.push(mutation);
    }
  }

  if (
    event.kind === "approval.requested" ||
    event.kind === "user_input.requested" ||
    event.kind === "request.resolved"
  ) {
    pushRequestEventMutations(event, mutations);
  }

  if (
    event.kind === "activity" ||
    event.kind === "audio.input" ||
    event.kind === "audio.output" ||
    event.kind === "error" ||
    event.kind === "interruption" ||
    event.kind === "session.lifecycle" ||
    event.kind === "task" ||
    event.kind === "thread" ||
    event.kind === "tool.call" ||
    event.kind === "usage"
  ) {
    mutations.push(buildRuntimeActivityMutationFromEvent(event, createdAt));
  }

  return {
    threadId,
    sequence: event.sourceSeq,
    mutations
  };
};
