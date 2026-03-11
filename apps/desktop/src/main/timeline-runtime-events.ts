import { randomUUID } from "node:crypto";
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
  TimelineUserInputOption,
  TimelineUserInputQuestion,
  TimelineUserInputRequest
} from "@shared";
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
] as const;

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

const buildPlanSteps = (value: unknown): TimelinePlanStep[] =>
  Array.isArray(value)
    ? value
        .map((entry) => {
          if (!isRecord(entry) || typeof entry.step !== "string") {
            return null;
          }

          return {
            step: entry.step,
            status:
              entry.status === "completed" ||
              entry.status === "in_progress" ||
              entry.status === "pending"
                ? entry.status
                : "pending"
          } satisfies TimelinePlanStep;
        })
        .filter((entry): entry is TimelinePlanStep => entry !== null)
    : [];

const mapApprovalDecisions = (value: unknown): ApprovalDecision[] => {
  if (!Array.isArray(value)) {
    return ["accept", "decline", "cancel"];
  }

  const decisions = value.filter(
    (entry): entry is ApprovalDecision =>
      entry === "accept" ||
      entry === "acceptForSession" ||
      entry === "decline" ||
      entry === "cancel"
  );

  return decisions.length > 0 ? decisions : ["accept", "decline", "cancel"];
};

const mapUserInputOptions = (value: unknown): TimelineUserInputOption[] =>
  Array.isArray(value)
    ? value
        .map((entry) => {
          if (!isRecord(entry) || typeof entry.label !== "string") {
            return null;
          }

          return {
            label: entry.label,
            description: typeof entry.description === "string" ? entry.description : ""
          } satisfies TimelineUserInputOption;
        })
        .filter((entry): entry is TimelineUserInputOption => entry !== null)
    : [];

const mapUserInputQuestions = (value: unknown): TimelineUserInputQuestion[] =>
  Array.isArray(value)
    ? value
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
        .filter((entry): entry is TimelineUserInputQuestion => entry !== null)
    : [];

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

const normalizeRequestType = (value: unknown) => toCanonicalToken(asString(value));

const resolveRequestTypeFromMethod = (methodKey: string | null) => {
  switch (methodKey) {
    case "item_command_execution_request_approval":
      return "command_execution_approval";
    case "item_exec_command_request_approval":
      return "exec_command_approval";
    case "item_file_change_request_approval":
      return "file_change_approval";
    case "item_file_read_request_approval":
      return "file_read_approval";
    case "item_apply_patch_request_approval":
      return "apply_patch_approval";
    case "item_tool_request_user_input":
      return "tool_user_input";
    default:
      return methodKey;
  }
};

const buildApprovalMutation = (
  requestId: string,
  requestType: string | null,
  params: Record<string, unknown>
): TimelineRuntimeMutation | null => {
  switch (requestType) {
    case "command_execution_approval":
    case "exec_command_approval": {
      const command = normalizeCommandValue(params.command);
      const cwd = asString(params.cwd);
      const reason = asString(params.reason);

      return {
        type: "upsertApproval",
        approval: {
          id: requestId,
          kind: "command",
          title: command ? `Run command: ${command}` : "Run command",
          detail: [cwd ? `cwd: ${cwd}` : null, reason].filter(Boolean).join("\n"),
          availableDecisions: mapApprovalDecisions(params.availableDecisions),
          isSubmitting: false
        }
      };
    }

    case "file_change_approval":
    case "apply_patch_approval":
    case "file_read_approval": {
      const reason = asString(params.reason);
      const grantRoot = asString(params.grantRoot) ?? asString(params.path);

      return {
        type: "upsertApproval",
        approval: {
          id: requestId,
          kind: "fileChange",
          title: requestType === "file_read_approval" ? "Read file" : "Apply file changes",
          detail: [reason, grantRoot ? `path: ${grantRoot}` : null].filter(Boolean).join("\n"),
          availableDecisions:
            requestType !== "file_read_approval" && grantRoot
              ? ["accept", "acceptForSession", "decline", "cancel"]
              : ["accept", "decline", "cancel"],
          isSubmitting: false
        }
      };
    }

    case "tool_user_input":
      return {
        type: "upsertUserInput",
        request: {
          id: requestId,
          title: "Clarification requested",
          questions: mapUserInputQuestions(params.questions),
          isSubmitting: false
        }
      };

    default:
      return null;
  }
};

const buildRuntimeActivityMutation = (
  methodKey: string,
  params: Record<string, unknown>,
  turnId: string | null,
  createdAt: string
): TimelineRuntimeMutation => {
  const label =
    asString(params.label) ??
    asString(params.title) ??
    asString(params.message) ??
    formatTokenLabel(methodKey);
  const detail = collectJoinedText(
    params.detail,
    params.summary,
    params.message,
    params.reason,
    params.output,
    params.text
  );
  const command = normalizeCommandValue(params.command);
  const toolName = asString(params.toolName) ?? asString(params.tool) ?? asString(params.name);
  const agentLabel = asString(params.agentLabel) ?? asString(params.agentName) ?? asString(params.agent);

  return {
    type: "upsertEntry",
    entry: {
      id:
        asString(params.itemId) ??
        asString(params.id) ??
        `${turnId ?? "thread"}-${methodKey}-${randomUUID()}`,
      kind: "activity",
      activityType: resolveActivityType(methodKey),
      createdAt,
      turnId,
      tone: resolveActivityTone(resolveActivityType(methodKey)),
      label,
      detail,
      command,
      changedFiles: collectChangedFiles(params.files ?? params.changes ?? params.output),
      status: resolveActivityStatus(params.status),
      toolName: toolName ?? null,
      agentLabel: agentLabel ?? null
    }
  };
};

export const normalizeBridgeRequest = (payload: RequestPayload) => {
  const params = isRecord(payload.params) ? payload.params : {};
  const threadId = asString(params.threadId);
  const mutations: TimelineRuntimeMutation[] = [];
  const methodKey = toCanonicalToken(payload.method);
  const requestType =
    normalizeRequestType(params.requestType) ?? resolveRequestTypeFromMethod(methodKey);

  const requestMutation = buildApprovalMutation(payload.id, requestType, params);

  if (requestMutation) {
    mutations.push(requestMutation);
  }

  return { threadId, mutations };
};

export const normalizeBridgeNotification = (payload: NotificationPayload) => {
  const params = isRecord(payload.params) ? payload.params : {};
  const threadId = asString(params.threadId);
  const turnId = asString(params.turnId);
  const createdAt = normalizeTimestamp(params.createdAt, "Live update");
  const methodKey = toCanonicalToken(payload.method);
  const latestTurn: TimelineTurn | null = turnId
    ? {
        id: turnId,
        status: "inProgress",
        startedAt: createdAt,
        completedAt: null
      }
    : null;
  const mutations: TimelineRuntimeMutation[] = [];

  if (methodKey === "turn_started") {
    mutations.push({
      type: "setRunState",
      runState: { phase: "running", label: "Working" },
      isRunning: true,
      latestTurn,
      activeWorkStartedAt: createdAt
    });
  } else if (methodKey === "turn_completed" || methodKey === "turn_aborted") {
    const turn = isRecord(params.turn) ? (params.turn as TurnRef) : null;
    const interrupted =
      methodKey === "turn_aborted" ||
      turn?.status === "interrupted" ||
      asString(params.reason) === "interrupted";
    const nextLatestTurn =
      turnId || asString(turn?.id)
        ? {
            id: turnId ?? asString(turn?.id) ?? randomUUID(),
            status: interrupted ? "interrupted" : turn?.status ?? "completed",
            startedAt: typeof turn?.startedAt === "string" ? turn.startedAt : null,
            completedAt:
              typeof turn?.completedAt === "string" ? turn.completedAt : normalizeTimestamp(params.createdAt, "Live update")
          }
        : null;
    const phase =
      turn?.status === "failed" ? "failed" : interrupted ? "interrupted" : "idle";
    const label = phase === "failed" ? "Failed" : phase === "interrupted" ? "Interrupted" : "Idle";
    mutations.push({
      type: "setRunState",
      runState: { phase, label },
      isRunning: false,
      latestTurn: nextLatestTurn,
      activeWorkStartedAt: null
    });
  }

  if (methodKey === "turn_plan_updated") {
    const explanation = asString(params.explanation) ?? "";
    const steps = buildPlanSteps(params.plan);
    mutations.push({
      type: "setActivePlan",
      plan: steps.length > 0 || explanation
        ? {
            id: `active-plan-${threadId ?? "thread"}`,
            createdAt,
            updatedAt: createdAt,
            turnId,
            title: explanation ? resolvePlanTitle(explanation) : "Plan",
            text: explanation,
            steps
          }
        : null
    });
    mutations.push(
      buildRuntimeActivityMutation(
        "plan_update",
        {
          ...params,
          label: "Plan updated",
          detail: explanation
        },
        turnId,
        createdAt
      )
    );
  }

  if (
    methodKey === "turn_proposed_delta" ||
    methodKey === "turn_proposed_completed" ||
    methodKey === "turn_proposed_updated"
  ) {
    const delta = asString(params.delta);
    const text = asString(params.planMarkdown) ?? asString(params.text) ?? delta ?? "";

    if (text) {
      mutations.push({
        type: "upsertLatestProposedPlan",
        merge:
          methodKey === "turn_proposed_delta" && !asString(params.planMarkdown) ? "append" : "replace",
        plan: buildProposedPlanEntry(
          asString(params.planId) ?? `${turnId ?? threadId ?? "thread"}-proposed-plan`,
          turnId,
          text,
          createdAt,
          createdAt
        )
      });
    }
  }

  if (methodKey === "turn_diff_updated") {
    const diff = asString(params.diff) ?? "";

    mutations.push({
      type: "setActiveDiffPreview",
      diff: buildDiffEntry(
        `live-diff-${turnId ?? threadId ?? randomUUID()}`,
        turnId,
        createdAt,
        collectChangedFiles(params.files),
        null,
        "Live diff preview",
        diff
      )
    });
  }

  if (methodKey === "item_agent_message_delta" || methodKey === "content_delta") {
    const delta = asString(params.delta);

    if (delta) {
      mutations.push({
        type: "appendAssistantDelta",
        id: asString(params.itemId) ?? randomUUID(),
        turnId,
        delta,
        createdAt
      });
    }
  }

  if (
    methodKey === "item_started" ||
    methodKey === "item_completed" ||
    methodKey === "item_updated"
  ) {
    const item = isRecord(params.item) ? (params.item as ThreadItem) : null;

    if (item) {
      const projected = projectTurnRecord(
        {
          id: turnId ?? randomUUID(),
          status: methodKey === "item_started" ? "inProgress" : "completed",
          items: [
            {
              ...item,
              status:
                methodKey === "item_started"
                  ? "in_progress"
                  : asString(item.status) ?? "completed"
            }
          ],
          createdAt
        },
        0
      );

      for (const entry of projected.entries) {
        if (entry.kind === "proposedPlan") {
          mutations.push({
            type: "upsertLatestProposedPlan",
            plan: entry,
            merge: "replace"
          });
          continue;
        }

        if (entry.kind === "diffSummary") {
          mutations.push({ type: "upsertTurnDiff", diff: entry });
          continue;
        }

        mutations.push({ type: "upsertEntry", entry });
      }
    }
  }

  if (methodKey === "request_opened") {
    const requestId = asString(params.requestId) ?? asString(params.id);
    const requestMutation =
      requestId && buildApprovalMutation(requestId, normalizeRequestType(params.requestType), params);

    if (requestMutation) {
      mutations.push(requestMutation);
    }
  }

  if (methodKey === "user_input_requested") {
    const requestId = asString(params.requestId) ?? asString(params.id) ?? randomUUID();
    mutations.push({
      type: "upsertUserInput",
      request: {
        id: requestId,
        title: asString(params.title) ?? "Clarification requested",
        questions: mapUserInputQuestions(params.questions),
        isSubmitting: false
      }
    });
  }

  if (
    methodKey === "server_request_resolved" ||
    methodKey === "request_resolved" ||
    methodKey === "user_input_resolved"
  ) {
    const requestId = asString(params.requestId);

    if (requestId) {
      mutations.push({ type: "resolveRequest", requestId });
    }
  }

  if (
    methodKey &&
    mutations.length === 0 &&
    threadId &&
    [
      "task_started",
      "task_progress",
      "task_completed",
      "hook_started",
      "hook_progress",
      "hook_completed",
      "tool_progress",
      "tool_summary",
      "runtime_warning",
      "runtime_error",
      "files_persisted",
      "thread_state_changed",
      "thread_metadata_updated",
      "session_state_changed"
    ].includes(methodKey)
  ) {
    mutations.push(buildRuntimeActivityMutation(methodKey, params, turnId, createdAt));
  }

  return {
    threadId,
    sequence:
      typeof params.sequence === "number"
        ? params.sequence
        : typeof params.eventSequence === "number"
          ? params.eventSequence
          : null,
    mutations
  };
};
