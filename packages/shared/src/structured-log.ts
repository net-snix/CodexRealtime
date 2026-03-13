import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type StructuredLogLevel = "info" | "warn" | "error" | "event";

export interface StructuredLogContext {
  correlationId?: string | null;
  threadId?: string | null;
  sessionId?: string | null;
  [key: string]: unknown;
}

export interface StructuredLogRecord {
  timestamp: string;
  source: string;
  scope: string;
  level: StructuredLogLevel;
  message: string;
  correlationId: string | null;
  threadId: string | null;
  sessionId: string | null;
  data: Record<string, unknown> | null;
}

export interface StructuredLogger {
  info(message: string, context?: StructuredLogContext): void;
  warn(message: string, context?: StructuredLogContext): void;
  error(message: string, context?: StructuredLogContext): void;
  event(message: string, context?: StructuredLogContext): void;
  child(scope: string, baseContext?: StructuredLogContext): StructuredLogger;
}

export interface CreateStructuredLoggerOptions {
  source: string;
  scope: string;
  logFilePath?: string | null;
  baseContext?: StructuredLogContext;
  clock?: () => Date;
  writeLine?: (line: string, level: StructuredLogLevel) => void;
}

const normalizeIdentifier = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const MAX_LOG_SERIALIZATION_DEPTH = 8;
const DEPTH_LIMIT_MARKER = "[DepthLimitExceeded]";
const REDACTED_LOG_VALUE = "[Redacted]";
const MAX_LOG_STRING_LENGTH = 4_096;
const MAX_LOG_ARRAY_ITEMS = 24;
const MAX_LOG_OBJECT_ENTRIES = 24;

const truncateLogString = (value: string) => {
  if (value.length <= MAX_LOG_STRING_LENGTH) {
    return value;
  }

  const truncatedCount = value.length - MAX_LOG_STRING_LENGTH;
  return `${value.slice(0, MAX_LOG_STRING_LENGTH)}...[+${truncatedCount} chars]`;
};

const tokenizeLogContextKey = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

const SENSITIVE_LOG_KEY_PATTERNS = [
  ["authorization"],
  ["cookie"],
  ["cookies"],
  ["password"],
  ["passphrase"],
  ["passwd"],
  ["pwd"],
  ["secret"],
  ["api", "key"],
  ["access", "token"],
  ["refresh", "token"],
  ["session", "token"],
  ["bearer", "token"],
  ["auth", "token"],
  ["client", "secret"],
  ["private", "key"],
  ["id", "token"]
] as const;

const hasTokenSequence = (tokens: string[], sequence: readonly string[]) => {
  if (sequence.length === 0 || tokens.length < sequence.length) {
    return false;
  }

  for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
    if (sequence.every((token, offset) => tokens[index + offset] === token)) {
      return true;
    }
  }

  return false;
};

const isSensitiveLogContextKey = (key: string) => {
  const tokens = tokenizeLogContextKey(key);

  if (tokens.length === 0) {
    return false;
  }

  return SENSITIVE_LOG_KEY_PATTERNS.some((pattern) => hasTokenSequence(tokens, pattern));
};

const serializeLogValue = (
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0
): unknown => {
  if (depth >= MAX_LOG_SERIALIZATION_DEPTH) {
    return DEPTH_LIMIT_MARKER;
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return truncateLogString(value);
  }

  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    const serializedError: Record<string, unknown> = {
      name: value.name,
      message: truncateLogString(value.message)
    };

    if (value.stack) {
      serializedError.stack = truncateLogString(value.stack);
    }

    if ("cause" in value) {
      const cause = serializeLogValue((value as { cause?: unknown }).cause, seen, depth + 1);
      if (cause !== undefined) {
        serializedError.cause = cause;
      }
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      const serializedValue = isSensitiveLogContextKey(key)
        ? REDACTED_LOG_VALUE
        : serializeLogValue(nestedValue, seen, depth + 1);
      if (serializedValue !== undefined) {
        serializedError[key] = serializedValue;
      }
    }

    return serializedError;
  }

  if (Array.isArray(value)) {
    const serializedItems = value
      .slice(0, MAX_LOG_ARRAY_ITEMS)
      .map((item) => serializeLogValue(item, seen, depth + 1));

    if (value.length > MAX_LOG_ARRAY_ITEMS) {
      serializedItems.push(`[+${value.length - MAX_LOG_ARRAY_ITEMS} items]`);
    }

    return serializedItems;
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);

    try {
      const entries = Object.entries(value);
      const serializedEntries = entries
        .slice(0, MAX_LOG_OBJECT_ENTRIES)
        .flatMap(([key, nestedValue]) => {
          const serializedValue = isSensitiveLogContextKey(key)
            ? REDACTED_LOG_VALUE
            : serializeLogValue(nestedValue, seen, depth + 1);
          return serializedValue === undefined ? [] : [[key, serializedValue] as const];
        });

      if (entries.length > MAX_LOG_OBJECT_ENTRIES) {
        serializedEntries.push([
          "__truncatedKeys",
          entries.length - MAX_LOG_OBJECT_ENTRIES
        ]);
      }

      return Object.fromEntries(serializedEntries);
    } finally {
      seen.delete(value);
    }
  }

  return String(value);
};

const sanitizeData = (context: StructuredLogContext | undefined) => {
  if (!context) {
    return null;
  }

  const data = Object.fromEntries(
    Object.entries(context).filter(
      ([key, value]) =>
        key !== "correlationId" &&
        key !== "threadId" &&
        key !== "sessionId" &&
        value !== undefined
    ).map(([key, value]) => [
      key,
      isSensitiveLogContextKey(key) ? REDACTED_LOG_VALUE : serializeLogValue(value)
    ])
  );

  return Object.keys(data).length > 0 ? data : null;
};

export const writeStructuredLogLine = (logFilePath: string, line: string) => {
  mkdirSync(dirname(logFilePath), { recursive: true });
  appendFileSync(logFilePath, `${line}\n`, "utf8");
};

export const createStructuredLogRecord = (input: {
  source: string;
  scope: string;
  level: StructuredLogLevel;
  message: string;
  context?: StructuredLogContext;
  baseContext?: StructuredLogContext;
  clock?: () => Date;
}): StructuredLogRecord => {
  const mergedContext = {
    ...input.baseContext,
    ...input.context
  };

  return {
    timestamp: (input.clock ?? (() => new Date()))().toISOString(),
    source: input.source,
    scope: input.scope,
    level: input.level,
    message: input.message,
    correlationId: normalizeIdentifier(mergedContext.correlationId),
    threadId: normalizeIdentifier(mergedContext.threadId),
    sessionId: normalizeIdentifier(mergedContext.sessionId),
    data: sanitizeData(mergedContext)
  };
};

const defaultWriteLine = (line: string, level: StructuredLogLevel) => {
  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
};

export const createStructuredLogger = (
  options: CreateStructuredLoggerOptions
): StructuredLogger => {
  const emit = (level: StructuredLogLevel, message: string, context?: StructuredLogContext) => {
    const record = createStructuredLogRecord({
      source: options.source,
      scope: options.scope,
      level,
      message,
      context,
      baseContext: options.baseContext,
      clock: options.clock
    });
    const line = JSON.stringify(record);

    (options.writeLine ?? defaultWriteLine)(line, level);

    if (options.logFilePath) {
      writeStructuredLogLine(options.logFilePath, line);
    }
  };

  return {
    info: (message, context) => emit("info", message, context),
    warn: (message, context) => emit("warn", message, context),
    error: (message, context) => emit("error", message, context),
    event: (message, context) => emit("event", message, context),
    child: (scope, baseContext) =>
      createStructuredLogger({
        ...options,
        scope,
        baseContext: {
          ...options.baseContext,
          ...baseContext
        }
      })
  };
};
