import {
  createStructuredLogRecord as createBaseStructuredLogRecord,
  createStructuredLogger as createBaseStructuredLogger,
  type CreateStructuredLoggerOptions as BaseStructuredLoggerOptions,
  type StructuredLogContext,
  type StructuredLogLevel,
  type StructuredLogRecord,
  type StructuredLogger
} from "@codex-realtime/shared/structured-log";

export type { StructuredLogContext, StructuredLogLevel, StructuredLogRecord, StructuredLogger };

export interface CreateStructuredLogRecordInput {
  scope: string;
  level: StructuredLogLevel;
  message: string;
  bootstrapId?: string | null;
  baseFields?: Record<string, unknown>;
  fields?: Record<string, unknown>;
  clock?: BaseStructuredLoggerOptions["clock"];
}

export interface CreateStructuredLoggerOptions {
  bootstrapId?: string | null;
  baseFields?: Record<string, unknown>;
  clock?: BaseStructuredLoggerOptions["clock"];
  logFilePath?: string | null;
  stderrOnly?: boolean;
  writeLine?: (line: string, level: StructuredLogLevel) => void;
}

const createWriteLine =
  (stderrOnly: boolean) =>
  (line: string, level: StructuredLogLevel) => {
    if (stderrOnly || level === "warn" || level === "error") {
      console.error(line);
      return;
    }

    console.log(line);
  };

const toBaseContext = (
  bootstrapId: string | null | undefined,
  baseFields: Record<string, unknown> | undefined
): StructuredLogContext => ({
  correlationId: bootstrapId ?? null,
  ...baseFields
});

export const createStructuredLogRecord = (input: CreateStructuredLogRecordInput): StructuredLogRecord =>
  createBaseStructuredLogRecord({
    source: "server",
    scope: input.scope,
    level: input.level,
    message: input.message,
    context: input.fields,
    baseContext: toBaseContext(input.bootstrapId, input.baseFields),
    clock: input.clock
  });

export const createStructuredLogger = (
  scope: string,
  options: CreateStructuredLoggerOptions = {}
): StructuredLogger =>
  createBaseStructuredLogger({
    source: "server",
    scope,
    logFilePath: options.logFilePath ?? null,
    baseContext: toBaseContext(options.bootstrapId, options.baseFields),
    clock: options.clock,
    writeLine: options.writeLine ?? createWriteLine(Boolean(options.stderrOnly))
  });
