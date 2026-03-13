import type { VoiceTaskEnvelope } from "@shared";

const RESTARTABLE_STEER_ERROR_PATTERNS = [
  /\bunknown turn\b/i,
  /\bturn not found\b/i,
  /\bexpected turn\b/i,
  /\bstale turn\b/i,
  /\bno active turn\b/i
];

const normalizeErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === "string" ? error : "";

export const resolveVoiceTaskEnvelope = (
  envelope: VoiceTaskEnvelope,
  workspaceId: string,
  threadId: string
): VoiceTaskEnvelope => ({
  ...envelope,
  workspaceId,
  threadId
});

export const isRestartableSteerError = (error: unknown) => {
  const message = normalizeErrorMessage(error);
  return RESTARTABLE_STEER_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};
