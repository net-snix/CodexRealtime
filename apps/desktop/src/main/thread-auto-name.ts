const MAX_AUTO_THREAD_NAME_LENGTH = 48;
const UNTITLED_THREAD_NAMES = new Set(["new thread", "untitled thread"]);

const collapseWhitespace = (value: string) => value.trim().replace(/\s+/g, " ");

const trimTrailingPunctuation = (value: string) =>
  value.replace(/[\s\-:;,.!?]+$/g, "").trim();

const truncateAtWordBoundary = (value: string, maxLength: number) => {
  if (value.length <= maxLength) {
    return value;
  }

  const slice = value.slice(0, maxLength + 1);
  const boundary = slice.lastIndexOf(" ");

  if (boundary >= Math.floor(maxLength * 0.55)) {
    return slice.slice(0, boundary);
  }

  return value.slice(0, maxLength);
};

export const normalizeAutoThreadName = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return null;
  }

  const collapsed = collapseWhitespace(value);

  if (!collapsed) {
    return null;
  }

  const trimmed = trimTrailingPunctuation(
    truncateAtWordBoundary(collapsed, MAX_AUTO_THREAD_NAME_LENGTH)
  );

  if (!trimmed || UNTITLED_THREAD_NAMES.has(trimmed.toLowerCase())) {
    return null;
  }

  return trimmed;
};

export const buildAutoThreadName = (
  summaryPreview: string | null | undefined,
  fallbackPrompt: string
) => normalizeAutoThreadName(summaryPreview) ?? normalizeAutoThreadName(fallbackPrompt);
