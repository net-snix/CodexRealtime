export const isThreadNotMaterializedError = (error: unknown) => {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";

  return (
    message.includes("not materialized yet") ||
    message.includes("includeTurns is unavailable before first user message")
  );
};
