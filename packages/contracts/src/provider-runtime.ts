const isRecord = (value: unknown): value is Record<string, unknown> =>
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

const normalizeTimestamp = (value: unknown) =>
  typeof value === "string" && value.trim() ? value : null;

const normalizeCommandValue = (value: unknown): string | null => {
  const direct = asString(value);

  if (direct) {
    return direct.replace(/\s+/g, " ").trim();
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const parts = value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => entry !== null)
    .map((entry) => entry.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return parts.length > 0 ? parts.join(" ") : null;
};

const normalizeRequestType = (value: unknown) => toCanonicalToken(asString(value));

export type ProviderRuntimeProgressStatus =
  | "in_progress"
  | "completed"
  | "failed"
  | "declined"
  | null;

const normalizeProgressStatus = (value: unknown): ProviderRuntimeProgressStatus => {
  switch (toCanonicalToken(asString(value))) {
    case "running":
    case "started":
    case "in_progress":
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
      return null;
  }
};

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

export interface ProviderRuntimeFileChangeItem {
  path: string;
  additions: number;
  deletions: number;
  diff: string | null;
}

type ProviderRuntimeBase = {
  threadId: string | null;
  turnId: string | null;
  itemId: string | null;
  createdAt: string | null;
  commandId: string | null;
  sourceEventId: string | null;
  sourceSeq: number | null;
  sourceMethod: string;
};

export interface ProviderRuntimeMessageItem {
  kind: "message";
  id?: string | null;
  role: "user" | "assistant";
  text: string;
  completedAt: string | null;
  providerLabel: string | null;
}

export interface ProviderRuntimeActivityItem {
  kind: "activity";
  id?: string | null;
  sourceType?: string | null;
  activityType: string | null;
  label: string | null;
  detail: string | null;
  command: string | null;
  changedFiles: ProviderRuntimeFileChangeItem[];
  status: ProviderRuntimeProgressStatus;
  toolName: string | null;
  agentLabel: string | null;
}

export interface ProviderRuntimePlanItem {
  kind: "plan";
  id?: string | null;
  text: string;
  updatedAt: string | null;
  completedAt: string | null;
}

export interface ProviderRuntimeDiffItem {
  kind: "file_change";
  id?: string | null;
  title: string | null;
  diff: string | null;
  files: ProviderRuntimeFileChangeItem[];
}

export type ProviderRuntimeNotificationPayload = {
  method: string;
  params?: unknown;
};

export type ProviderRuntimeRequestPayload = {
  id: string;
  method: string;
  params?: unknown;
};

export type ProviderRuntimeTimelineItem =
  | ProviderRuntimeMessageItem
  | ProviderRuntimeActivityItem
  | ProviderRuntimePlanItem
  | ProviderRuntimeDiffItem;

export type ProviderRuntimeApprovalRequestEvent = ProviderRuntimeBase & {
  kind: "approval.requested";
  requestId: string;
  requestType: string | null;
  command: string | null;
  cwd: string | null;
  reason: string | null;
  grantRoot: string | null;
  availableDecisions: readonly string[];
};

export type ProviderRuntimeUserInputRequestEvent = ProviderRuntimeBase & {
  kind: "user_input.requested";
  requestId: string;
  title: string | null;
  questions: unknown;
};

export type ProviderRuntimeRequestResolvedEvent = ProviderRuntimeBase & {
  kind: "request.resolved";
  requestId: string;
};

export type ProviderRuntimeTurnLifecycleEvent = ProviderRuntimeBase & {
  kind: "turn.lifecycle";
  phase: "started" | "completed" | "aborted";
  reason: string | null;
  turn: {
    id: string | null;
    status: "completed" | "interrupted" | "failed" | "inProgress" | null;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
};

export type ProviderRuntimePlanEvent = ProviderRuntimeBase & {
  kind: "turn.plan";
  planKind: "active" | "proposed";
  planId: string | null;
  text: string;
  explanation: string | null;
  steps: unknown[];
  merge: "replace" | "append";
};

export type ProviderRuntimeDiffEvent = ProviderRuntimeBase & {
  kind: "turn.diff";
  diffId: string | null;
  diff: string;
  files: ProviderRuntimeFileChangeItem[];
  title: string | null;
  assistantMessageId: string | null;
};

export type ProviderRuntimeMessageDeltaEvent = ProviderRuntimeBase & {
  kind: "message.delta";
  delta: string;
};

export type ProviderRuntimeItemLifecycleEvent = ProviderRuntimeBase & {
  kind: "item.lifecycle";
  phase: "started" | "completed" | "updated";
  item: ProviderRuntimeTimelineItem;
};

export type ProviderRuntimeToolCallEvent = ProviderRuntimeBase & {
  kind: "tool.call";
  label: string | null;
  detail: string | null;
  toolName: string | null;
  status: ProviderRuntimeProgressStatus;
  agentLabel: string | null;
  command: string | null;
  files: ProviderRuntimeFileChangeItem[];
};

export type ProviderRuntimeTaskEvent = ProviderRuntimeBase & {
  kind: "task";
  label: string | null;
  detail: string | null;
  toolName: string | null;
  status: ProviderRuntimeProgressStatus;
  agentLabel: string | null;
  command: string | null;
  files: ProviderRuntimeFileChangeItem[];
};

export type ProviderRuntimeThreadEvent = ProviderRuntimeBase & {
  kind: "thread";
  title: string | null;
  detail: string | null;
  files: ProviderRuntimeFileChangeItem[];
};

export type ProviderRuntimeActivityEvent = ProviderRuntimeBase & {
  kind: "activity";
  activityType: string;
  label: string | null;
  detail: string | null;
  toolName: string | null;
  status: ProviderRuntimeProgressStatus;
  agentLabel: string | null;
  command: string | null;
  files: ProviderRuntimeFileChangeItem[];
};

export type ProviderRuntimeSessionLifecycleEvent = ProviderRuntimeBase & {
  kind: "session.lifecycle";
  state: string | null;
  detail: string | null;
  error: string | null;
};

export type ProviderRuntimeAudioInputEvent = ProviderRuntimeBase & {
  kind: "audio.input";
  phase: string;
  transcript: string | null;
  delta: string | null;
};

export type ProviderRuntimeAudioOutputEvent = ProviderRuntimeBase & {
  kind: "audio.output";
  phase: string;
  transcript: string | null;
  delta: string | null;
};

export type ProviderRuntimeInterruptionEvent = ProviderRuntimeBase & {
  kind: "interruption";
  reason: string | null;
};

export type ProviderRuntimeUsageEvent = ProviderRuntimeBase & {
  kind: "usage";
  usage: Record<string, number>;
};

export type ProviderRuntimeErrorEvent = ProviderRuntimeBase & {
  kind: "error";
  message: string;
  detail: string | null;
};

export type ProviderRuntimeEvent =
  | ProviderRuntimeApprovalRequestEvent
  | ProviderRuntimeUserInputRequestEvent
  | ProviderRuntimeRequestResolvedEvent
  | ProviderRuntimeTurnLifecycleEvent
  | ProviderRuntimePlanEvent
  | ProviderRuntimeDiffEvent
  | ProviderRuntimeMessageDeltaEvent
  | ProviderRuntimeItemLifecycleEvent
  | ProviderRuntimeToolCallEvent
  | ProviderRuntimeTaskEvent
  | ProviderRuntimeThreadEvent
  | ProviderRuntimeActivityEvent
  | ProviderRuntimeSessionLifecycleEvent
  | ProviderRuntimeAudioInputEvent
  | ProviderRuntimeAudioOutputEvent
  | ProviderRuntimeInterruptionEvent
  | ProviderRuntimeUsageEvent
  | ProviderRuntimeErrorEvent;

const countDiffStats = (diff: string) => {
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split("\n")) {
    if (!line) {
      continue;
    }

    if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("@@")) {
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

const buildChangedFile = (change: unknown): ProviderRuntimeFileChangeItem | null => {
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

const collectChangedFiles = (value: unknown, seen = new Set<string>()): ProviderRuntimeFileChangeItem[] => {
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
  const nextFiles: ProviderRuntimeFileChangeItem[] = [];

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

    if (nextFiles.length >= 24) {
      break;
    }
  }

  return nextFiles.slice(0, 24);
};

const buildBaseEvent = (
  methodKey: string | null,
  params: Record<string, unknown>
): ProviderRuntimeBase => ({
  threadId: asString(params.threadId),
  turnId: asString(params.turnId),
  itemId: asString(params.itemId) ?? asString(params.id),
  createdAt: normalizeTimestamp(params.createdAt),
  commandId: asString(params.commandId),
  sourceEventId: asString(params.sourceEventId),
  sourceSeq:
    typeof params.sourceSeq === "number"
      ? params.sourceSeq
      : typeof params.sequence === "number"
        ? params.sequence
        : typeof params.eventSequence === "number"
          ? params.eventSequence
          : null,
  sourceMethod: methodKey ?? "runtime_event"
});

const buildActivityFromItem = (
  item: Record<string, unknown>
): ProviderRuntimeActivityItem => ({
  kind: "activity",
  id: asString(item.id),
  sourceType: toCanonicalToken(asString(item.type)),
  activityType: toCanonicalToken(asString(item.type)),
  label: asString(item.label) ?? asString(item.title) ?? asString(item.message),
  detail: collectJoinedText(item.detail, item.summary, item.message, item.reason, item.output, item.text),
  command: normalizeCommandValue(item.command),
  changedFiles: collectChangedFiles(item.files ?? item.changes ?? item.output),
  status: normalizeProgressStatus(item.status),
  toolName: asString(item.toolName) ?? asString(item.tool) ?? asString(item.name),
  agentLabel: asString(item.agentLabel) ?? asString(item.agentName) ?? asString(item.agent)
});

export const normalizeProviderRuntimeItem = (
  item: Record<string, unknown>
): ProviderRuntimeTimelineItem => {
  const rawType = asString(item.type);

  if (rawType === "userMessage" || rawType === "agentMessage") {
    return {
      kind: "message",
      id: asString(item.id),
      role: rawType === "userMessage" ? "user" : "assistant",
      text: collectTextParts(item.content ?? item.text).join("\n"),
      completedAt: normalizeTimestamp(item.completedAt),
      providerLabel: asString(item.providerLabel)
    };
  }

  if (rawType === "plan") {
    return {
      kind: "plan",
      id: asString(item.id),
      text: collectTextParts(item.text ?? item.content).join("\n"),
      updatedAt: normalizeTimestamp(item.updatedAt),
      completedAt: normalizeTimestamp(item.completedAt)
    };
  }

  if (rawType === "fileChange") {
    return {
      kind: "file_change",
      id: asString(item.id),
      title: asString(item.title),
      diff: asString(item.diff),
      files: collectChangedFiles(item.changes ?? item.files)
    };
  }

  return buildActivityFromItem(item);
};

export const normalizeProviderRuntimeRequest = (
  payload: ProviderRuntimeRequestPayload
): ProviderRuntimeEvent | null => {
  const params = isRecord(payload.params) ? payload.params : {};
  const methodKey = toCanonicalToken(payload.method);
  const requestType =
    normalizeRequestType(params.requestType) ?? resolveRequestTypeFromMethod(methodKey);
  const base = buildBaseEvent(methodKey, params);

  if (requestType === "tool_user_input") {
    return {
      ...base,
      kind: "user_input.requested",
      requestId: payload.id,
      title: asString(params.title) ?? "Clarification requested",
      questions: params.questions ?? []
    };
  }

  if (requestType?.endsWith("_approval")) {
    return {
      ...base,
      kind: "approval.requested",
      requestId: payload.id,
      requestType,
      command: normalizeCommandValue(params.command),
      cwd: asString(params.cwd),
      reason: asString(params.reason),
      grantRoot: asString(params.grantRoot) ?? asString(params.path),
      availableDecisions: Array.isArray(params.availableDecisions)
        ? params.availableDecisions.filter((entry): entry is string => typeof entry === "string")
        : ["accept", "decline", "cancel"]
    };
  }

  return null;
};

export const normalizeProviderRuntimeNotification = (
  payload: ProviderRuntimeNotificationPayload
): ProviderRuntimeEvent | null => {
  const params = isRecord(payload.params) ? payload.params : {};
  const methodKey = toCanonicalToken(payload.method);
  const base = buildBaseEvent(methodKey, params);

  switch (methodKey) {
    case "turn_started":
    case "turn_completed":
    case "turn_aborted": {
      const turn = isRecord(params.turn) ? params.turn : null;
      return {
        ...base,
        kind: "turn.lifecycle",
        phase: methodKey === "turn_started" ? "started" : methodKey === "turn_aborted" ? "aborted" : "completed",
        reason: asString(params.reason),
        turn: {
          id: asString(turn?.id) ?? base.turnId,
          status:
            turn && typeof turn.status === "string"
              ? (turn.status as NonNullable<ProviderRuntimeTurnLifecycleEvent["turn"]>["status"])
              : methodKey === "turn_started"
                ? "inProgress"
                : methodKey === "turn_aborted"
                  ? "interrupted"
                  : "completed",
          startedAt: normalizeTimestamp(turn?.startedAt) ?? base.createdAt,
          completedAt: normalizeTimestamp(turn?.completedAt)
        }
      };
    }

    case "turn_plan_updated":
      return {
        ...base,
        kind: "turn.plan",
        planKind: "active",
        planId: null,
        text: asString(params.explanation) ?? "",
        explanation: asString(params.explanation),
        steps: Array.isArray(params.plan) ? params.plan : [],
        merge: "replace"
      };

    case "turn_proposed_delta":
    case "turn_proposed_completed":
    case "turn_proposed_updated": {
      const delta = asString(params.delta);
      const text = asString(params.planMarkdown) ?? asString(params.text) ?? delta ?? "";

      if (!text) {
        return null;
      }

      return {
        ...base,
        kind: "turn.plan",
        planKind: "proposed",
        planId: asString(params.planId),
        text,
        explanation: null,
        steps: [],
        merge: methodKey === "turn_proposed_delta" && !asString(params.planMarkdown) ? "append" : "replace"
      };
    }

    case "turn_diff_updated":
      return {
        ...base,
        kind: "turn.diff",
        diffId: asString(params.diffId),
        diff: asString(params.diff) ?? "",
        files: collectChangedFiles(params.files),
        title: asString(params.title),
        assistantMessageId: asString(params.assistantMessageId)
      };

    case "item_agent_message_delta":
    case "content_delta": {
      const delta = asString(params.delta);
      if (!delta) {
        return null;
      }

      return {
        ...base,
        kind: "message.delta",
        delta
      };
    }

    case "item_started":
    case "item_completed":
    case "item_updated": {
      const item = isRecord(params.item) ? params.item : null;
      if (!item) {
        return null;
      }

      const phase =
        methodKey === "item_started"
          ? "started"
          : methodKey === "item_completed"
            ? "completed"
            : "updated";
      const normalizedItem = normalizeProviderRuntimeItem(item);

      return {
        ...base,
        kind: "item.lifecycle",
        phase,
        item:
          normalizedItem.kind === "activity"
            ? {
                ...normalizedItem,
                status:
                  normalizedItem.status ??
                  (phase === "started" ? "in_progress" : phase === "completed" ? "completed" : null),
                label:
                  normalizedItem.label ??
                  asString(params.label) ??
                  asString(params.title) ??
                  asString(params.message) ??
                  (normalizedItem.command ? `Ran ${normalizedItem.command}` : null),
                detail:
                  normalizedItem.detail ??
                  collectJoinedText(
                    params.detail,
                    params.summary,
                    params.message,
                    params.reason,
                    params.output,
                    params.text
                  ),
                command: normalizedItem.command ?? normalizeCommandValue(params.command),
                changedFiles:
                  normalizedItem.changedFiles.length > 0
                    ? normalizedItem.changedFiles
                    : collectChangedFiles(params.files ?? params.changes ?? params.output),
                toolName:
                  normalizedItem.toolName ??
                  asString(params.toolName) ??
                  asString(params.tool) ??
                  asString(params.name),
                agentLabel:
                  normalizedItem.agentLabel ??
                  asString(params.agentLabel) ??
                  asString(params.agentName) ??
                  asString(params.agent)
              }
            : normalizedItem
      };
    }

    case "request_opened": {
      const requestId = asString(params.requestId) ?? asString(params.id);
      if (!requestId) {
        return null;
      }

      return {
        ...base,
        kind: "approval.requested",
        requestId,
        requestType: normalizeRequestType(params.requestType),
        command: normalizeCommandValue(params.command),
        cwd: asString(params.cwd),
        reason: asString(params.reason),
        grantRoot: asString(params.grantRoot) ?? asString(params.path),
        availableDecisions: Array.isArray(params.availableDecisions)
          ? params.availableDecisions.filter((entry): entry is string => typeof entry === "string")
          : ["accept", "decline", "cancel"]
      };
    }

    case "user_input_requested": {
      const requestId = asString(params.requestId) ?? asString(params.id);
      if (!requestId) {
        return null;
      }

      return {
        ...base,
        kind: "user_input.requested",
        requestId,
        title: asString(params.title) ?? "Clarification requested",
        questions: params.questions ?? []
      };
    }

    case "server_request_resolved":
    case "request_resolved":
    case "user_input_resolved": {
      const requestId = asString(params.requestId);
      if (!requestId) {
        return null;
      }

      return {
        ...base,
        kind: "request.resolved",
        requestId
      };
    }

    case "tool_progress":
    case "tool_summary":
      return {
        ...base,
        kind: "tool.call",
        label: asString(params.label) ?? asString(params.message),
        detail: collectJoinedText(params.detail, params.summary, params.message, params.reason, params.output),
        toolName: asString(params.toolName) ?? asString(params.tool) ?? asString(params.name),
        status: normalizeProgressStatus(params.status),
        agentLabel: asString(params.agentLabel) ?? asString(params.agentName) ?? asString(params.agent),
        command: normalizeCommandValue(params.command),
        files: collectChangedFiles(params.files ?? params.changes ?? params.output)
      };

    case "task_started":
    case "task_progress":
    case "task_completed":
      return {
        ...base,
        kind: "task",
        label: asString(params.label) ?? asString(params.message),
        detail: collectJoinedText(params.detail, params.summary, params.message, params.reason, params.output),
        toolName: asString(params.toolName) ?? asString(params.tool) ?? asString(params.name),
        status: normalizeProgressStatus(params.status),
        agentLabel: asString(params.agentLabel) ?? asString(params.agentName) ?? asString(params.agent),
        command: normalizeCommandValue(params.command),
        files: collectChangedFiles(params.files ?? params.changes ?? params.output)
      };

    case "thread_state_changed":
    case "thread_metadata_updated":
    case "files_persisted":
      return {
        ...base,
        kind: "thread",
        title: asString(params.title) ?? asString(params.label),
        detail: collectJoinedText(params.detail, params.summary, params.message, params.reason),
        files: collectChangedFiles(params.files ?? params.changes ?? params.output)
      };

    case "session_state_changed":
      return {
        ...base,
        kind: "session.lifecycle",
        state: asString(params.state),
        detail: collectJoinedText(params.detail, params.summary, params.message),
        error: asString(params.error)
      };

    case "runtime_error":
      return {
        ...base,
        kind: "error",
        message: asString(params.message) ?? "Runtime error",
        detail: collectJoinedText(params.detail, params.summary, params.reason, params.output)
      };

    case "thread_realtime_input_audio_started":
    case "thread_realtime_input_audio_delta":
    case "thread_realtime_input_audio_completed":
      return {
        ...base,
        kind: "audio.input",
        phase: methodKey.replace("thread_realtime_input_audio_", ""),
        transcript: asString(params.transcript),
        delta: asString(params.delta)
      };

    case "thread_realtime_output_audio_started":
    case "thread_realtime_output_audio_delta":
    case "thread_realtime_output_audio_completed":
      return {
        ...base,
        kind: "audio.output",
        phase: methodKey.replace("thread_realtime_output_audio_", ""),
        transcript: asString(params.transcript),
        delta: asString(params.delta)
      };

    case "thread_realtime_interrupted":
      return {
        ...base,
        kind: "interruption",
        reason: asString(params.reason)
      };

    case "usage_updated":
      return {
        ...base,
        kind: "usage",
        usage: isRecord(params.usage)
          ? (Object.fromEntries(
              Object.entries(params.usage).filter(([, value]) => typeof value === "number")
            ) as Record<string, number>)
          : {}
      };

    default:
      if (methodKey && ["hook_started", "hook_progress", "hook_completed", "runtime_warning"].includes(methodKey)) {
        return {
          ...base,
          kind: "activity",
          activityType: methodKey,
          label: asString(params.label) ?? asString(params.title) ?? asString(params.message),
          detail: collectJoinedText(params.detail, params.summary, params.message, params.reason, params.output),
          toolName: asString(params.toolName) ?? asString(params.tool) ?? asString(params.name),
          status: normalizeProgressStatus(params.status),
          agentLabel: asString(params.agentLabel) ?? asString(params.agentName) ?? asString(params.agent),
          command: normalizeCommandValue(params.command),
          files: collectChangedFiles(params.files ?? params.changes ?? params.output)
        };
      }

      return null;
  }
};
