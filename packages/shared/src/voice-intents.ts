import type { RealtimeTranscriptEntry, VoiceIntent, VoiceTaskEnvelope } from "@codex-realtime/contracts";

const ACTION_VERBS = [
  "inspect",
  "check",
  "open",
  "look at",
  "search",
  "find",
  "fix",
  "change",
  "edit",
  "update",
  "refactor",
  "add",
  "remove",
  "rename",
  "run",
  "test",
  "build",
  "lint",
  "debug",
  "commit",
  "push"
] as const;
const REPO_TARGETS = [
  "repo",
  "repository",
  "code",
  "file",
  "folder",
  "path",
  "module",
  "function",
  "component",
  "test",
  "diff",
  "command",
  "branch",
  "package",
  "workspace"
] as const;
const INTERRUPT_PHRASES = [
  "stop",
  "stop that",
  "stop now",
  "cancel",
  "cancel that",
  "abort",
  "hold on",
  "pause",
  "never mind"
] as const;

export type ParsedRealtimeVoiceItem = {
  transcriptEntry: RealtimeTranscriptEntry;
  intent: VoiceIntent | null;
  dedupeKeys: string[];
  richness: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

const normalizeText = (value: unknown): string[] => {
  if (typeof value === "string") {
    const text = value.trim();
    return text ? [text] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeText(entry));
  }

  if (!isRecord(value)) {
    return [];
  }

  return [
    ...normalizeText(value.text),
    ...normalizeText(value.transcript),
    ...normalizeText(value.delta),
    ...normalizeText(value.summary),
    ...normalizeText(value.content)
  ];
};

const joinText = (...values: unknown[]) => {
  const seen = new Set<string>();
  const parts: string[] = [];

  for (const value of values) {
    for (const text of normalizeText(value)) {
      if (seen.has(text)) {
        continue;
      }

      seen.add(text);
      parts.push(text);
    }
  }

  return parts.join("\n").trim();
};

const defaultCreatedAt = () =>
  new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });

const normalizeIntentTextKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
export const normalizeVoiceDispatchKey = normalizeIntentTextKey;

const looksLikePathOrCommand = (value: string) =>
  /(?:\b[\w.-]+\.(?:ts|tsx|js|jsx|json|md|css|html|swift|py|sh)\b|\/[\w./-]+|\b(?:pnpm|npm|git|node|cargo|swift)\b)/i.test(
    value
  );

const isInterruptPhrase = (value: string) =>
  INTERRUPT_PHRASES.includes(value.trim().toLowerCase().replace(/[.!?]+$/g, "") as (typeof INTERRUPT_PHRASES)[number]);

const shouldCreateWorkRequest = (value: string) => {
  const normalizedValue = value.trim().toLowerCase();

  if (!normalizedValue) {
    return false;
  }

  const hasActionVerb = ACTION_VERBS.some((verb) => normalizedValue.includes(verb));
  const hasRepoTarget = REPO_TARGETS.some((target) => normalizedValue.includes(target));

  return (hasActionVerb && hasRepoTarget) || looksLikePathOrCommand(value);
};

const pickSourceItemId = (item: Record<string, unknown>) => {
  if (typeof item.item_id === "string") {
    return item.item_id;
  }

  if (typeof item.id === "string") {
    return item.id;
  }

  return null;
};

const pickHandoffId = (item: Record<string, unknown>) =>
  typeof item.handoff_id === "string" ? item.handoff_id : null;

const collectSourceMessageIds = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const ids: string[] = [];

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const nextId =
      typeof entry.item_id === "string"
        ? entry.item_id
        : typeof entry.id === "string"
          ? entry.id
          : null;

    if (!nextId || seen.has(nextId)) {
      continue;
    }

    seen.add(nextId);
    ids.push(nextId);
  }

  return ids;
};

const buildDedupeKeys = ({
  handoffId,
  sourceMessageIds,
  itemId,
  transcript
}: {
  handoffId: string | null;
  sourceMessageIds: string[];
  itemId: string | null;
  transcript: string;
}) => {
  const keys: string[] = [];

  if (handoffId) {
    keys.push(`handoff:${handoffId}`);
  }

  for (const sourceMessageId of sourceMessageIds) {
    keys.push(`item:${sourceMessageId}`);
  }

  if (itemId) {
    keys.push(`item:${itemId}`);
  }

  const normalizedText = normalizeIntentTextKey(transcript);
  if (normalizedText) {
    keys.push(`text:${normalizedText}`);
  }

  return Array.from(new Set(keys));
};

const buildTaskEnvelope = ({
  transcript,
  sourceType,
  sourceItemId,
  handoffId,
  sourceMessageIds,
  rawPayload
}: {
  transcript: string;
  sourceType: "message" | "handoff_request";
  sourceItemId: string | null;
  handoffId: string | null;
  sourceMessageIds: string[];
  rawPayload: Record<string, unknown>;
}): VoiceTaskEnvelope => ({
  workspaceId: null,
  threadId: null,
  source: sourceType,
  sourceItemId,
  handoffId,
  transcript,
  userGoal: transcript,
  distilledPrompt: transcript,
  constraints: [],
  acceptanceCriteria: [],
  clarificationPolicy: "request_user_input",
  replyStyle: "concise milestones + clear final summary",
  sourceMessageIds,
  rawPayload
});

const createIntent = ({
  sourceType,
  sourceItemId,
  handoffId,
  transcript,
  rawPayload,
  sourceMessageIds
}: {
  sourceType: "message" | "handoff_request";
  sourceItemId: string | null;
  handoffId: string | null;
  transcript: string;
  rawPayload: Record<string, unknown>;
  sourceMessageIds: string[];
}): VoiceIntent => {
  const source = {
    sourceType,
    itemId: sourceItemId,
    handoffId,
    transcript,
    metadata: rawPayload
  } as const;

  if (isInterruptPhrase(transcript)) {
    return {
      kind: "interrupt_request",
      source,
      reason: transcript
    };
  }

  if (sourceType === "handoff_request" || shouldCreateWorkRequest(transcript)) {
    return {
      kind: "work_request",
      source,
      taskEnvelope: buildTaskEnvelope({
        transcript,
        sourceType,
        sourceItemId,
        handoffId,
        sourceMessageIds,
        rawPayload
      })
    };
  }

  return {
    kind: "conversation",
    source
  };
};

const parseMessageItem = (
  item: Record<string, unknown>,
  createdAt: string
): ParsedRealtimeVoiceItem | null => {
  const role = typeof item.role === "string" ? item.role : "system";
  const speaker: RealtimeTranscriptEntry["speaker"] =
    role === "assistant" ? "assistant" : role === "user" ? "user" : "system";
  const acceptedContentTypes =
    speaker === "assistant" ? ["output_text"] : speaker === "user" ? ["input_text"] : [];
  const text = acceptedContentTypes.length
    ? joinText(
        Array.isArray(item.content)
          ? item.content.filter(
              (entry) =>
                isRecord(entry) &&
                typeof entry.type === "string" &&
                acceptedContentTypes.includes(entry.type)
            )
          : [],
        item.text,
        item.transcript
      )
    : joinText(item.text, item.transcript, item.content);

  if (!text) {
    return null;
  }

  const itemId = pickSourceItemId(item);
  const dedupeKeys =
    speaker === "user"
      ? buildDedupeKeys({
          handoffId: null,
          sourceMessageIds: itemId ? [itemId] : [],
          itemId,
          transcript: text
        })
      : itemId
        ? [`item:${itemId}`]
        : [`message:${normalizeIntentTextKey(text)}`];

  return {
    transcriptEntry: {
      id: dedupeKeys[0] ?? `message:${normalizeIntentTextKey(text)}`,
      speaker,
      text,
      status: item.status === "in_progress" ? "partial" : "final",
      createdAt
    },
    intent:
      speaker === "user" && item.status !== "in_progress"
        ? createIntent({
            sourceType: "message",
            sourceItemId: itemId,
            handoffId: null,
            transcript: text,
            rawPayload: item,
            sourceMessageIds: itemId ? [itemId] : []
          })
        : null,
    dedupeKeys,
    richness: 1
  };
};

const parseHandoffRequest = (
  item: Record<string, unknown>,
  createdAt: string
): ParsedRealtimeVoiceItem | null => {
  const sourceMessageIds = collectSourceMessageIds(item.messages);
  const transcript = joinText(
    item.input_transcript,
    item.text,
    item.transcript,
    Array.isArray(item.messages)
      ? item.messages.map((message) => (isRecord(message) ? message.text : null))
      : []
  );

  if (!transcript) {
    return null;
  }

  const itemId = pickSourceItemId(item);
  const handoffId = pickHandoffId(item);
  const dedupeKeys = buildDedupeKeys({
    handoffId,
    sourceMessageIds,
    itemId,
    transcript
  });

  return {
    transcriptEntry: {
      id: dedupeKeys[0] ?? `handoff:${normalizeIntentTextKey(transcript)}`,
      speaker: "user",
      text: transcript,
      status: "final",
      createdAt
    },
    intent: createIntent({
      sourceType: "handoff_request",
      sourceItemId: itemId,
      handoffId,
      transcript,
      rawPayload: item,
      sourceMessageIds
    }),
    dedupeKeys,
    richness: 2
  };
};

export const shouldDelayVoiceIntent = (intent: VoiceIntent) =>
  intent.kind === "work_request" && intent.source.sourceType === "message";

export const createVoiceIntentFromTranscript = ({
  transcript,
  id,
  createdAt
}: {
  transcript: string;
  id?: string | null;
  createdAt?: string;
}): ParsedRealtimeVoiceItem | null => {
  const trimmedTranscript = transcript.trim();

  if (!trimmedTranscript) {
    return null;
  }

  const normalizedTranscript = normalizeIntentTextKey(trimmedTranscript);
  const transcriptId = id?.trim() || `transcript:${normalizedTranscript}`;
  const safeCreatedAt = createdAt ?? defaultCreatedAt();

  return {
    transcriptEntry: {
      id: transcriptId,
      speaker: "user",
      text: trimmedTranscript,
      status: "final",
      createdAt: safeCreatedAt
    },
    intent: createIntent({
      sourceType: "message",
      sourceItemId: transcriptId,
      handoffId: null,
      transcript: trimmedTranscript,
      rawPayload: {
        type: "transcript",
        id: transcriptId,
        text: trimmedTranscript
      },
      sourceMessageIds: [transcriptId]
    }),
    dedupeKeys: buildDedupeKeys({
      handoffId: null,
      sourceMessageIds: [transcriptId],
      itemId: transcriptId,
      transcript: trimmedTranscript
    }),
    richness: 1
  };
};

export const parseRealtimeVoiceItem = (
  item: unknown,
  fallbackIndex: number
): ParsedRealtimeVoiceItem | null => {
  if (!isRecord(item)) {
    return null;
  }

  const createdAt = defaultCreatedAt();
  const type = typeof item.type === "string" ? item.type : "unknown";

  switch (type) {
    case "message":
      return parseMessageItem(item, createdAt);
    case "handoff_request":
      return parseHandoffRequest(item, createdAt);
    default: {
      const itemId = pickSourceItemId(item) ?? `${type}-${fallbackIndex}`;
      const text = joinText(item.text, item.transcript, item.content);

      if (!text) {
        return null;
      }

      return {
        transcriptEntry: {
          id: itemId,
          speaker: "system",
          text,
          status: item.status === "in_progress" ? "partial" : "final",
          createdAt
        },
        intent: null,
        dedupeKeys: [itemId],
        richness: 0
      };
    }
  }
};
