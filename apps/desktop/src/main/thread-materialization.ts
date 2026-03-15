const normalizeThreadErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === "string" ? error : "";

const hasThreadIdentity = (message: string) =>
  message.includes("thread") || message.includes("conversation");

export const isThreadNotMaterializedError = (error: unknown) => {
  const message = normalizeThreadErrorMessage(error).toLowerCase();

  return (
    message.includes("not materialized yet") ||
    message.includes("includeTurns is unavailable before first user message")
  );
};

export const isThreadNotFoundError = (error: unknown) => {
  const message = normalizeThreadErrorMessage(error).toLowerCase();

  return (
    hasThreadIdentity(message) &&
    (message.includes("not found") ||
      message.includes("found for thread id") ||
      message.includes("found for conversation id") ||
      message.includes("no rollout found") ||
      message.includes("no outline") ||
      message.includes("no conversation") ||
      message.includes("not exist") ||
      message.includes("does not exist") ||
      message.includes("invalid thread") ||
      message.includes("invalid conversation") ||
      message.includes("unknown thread") ||
      message.includes("unknown conversation"))
  );
};

export const isThreadUnavailableError = (error: unknown) =>
  isThreadNotMaterializedError(error) || isThreadNotFoundError(error);

export const isThreadUnavailableForArchiveError = (error: unknown) =>
  isThreadUnavailableError(error);
