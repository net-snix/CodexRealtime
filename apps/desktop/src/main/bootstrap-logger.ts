import { join } from "node:path";
import {
  createStructuredLogRecord as createBaseStructuredLogRecord,
  createStructuredLogger,
  type StructuredLogContext,
  type StructuredLogLevel,
  type StructuredLogRecord,
  type StructuredLogger
} from "@codex-realtime/shared/structured-log";

export type DesktopBootstrapLogger = Pick<StructuredLogger, "info" | "warn" | "error" | "event">;

export interface CreateBootstrapLogRecordInput {
  scope: string;
  level: StructuredLogLevel;
  message: string;
  bootstrapId: string;
  appVersion: string;
  userDataPath: string;
  context?: StructuredLogContext;
  clock?: () => Date;
}

export interface CreateBootstrapLoggerOptions {
  bootstrapId: string;
  appVersion: string;
  userDataPath: string;
  clock?: () => Date;
  writeLine?: (line: string, level: StructuredLogLevel) => void;
}

export interface BootstrapLoggerBundle {
  bootstrapLogger: DesktopBootstrapLogger;
  localServerLogger: DesktopBootstrapLogger;
  shutdownLogger: DesktopBootstrapLogger;
  paths: {
    logDirectory: string;
    desktopLogPath: string;
    serverLogPath: string;
  };
}

const toBaseContext = (options: {
  bootstrapId: string;
  appVersion: string;
  userDataPath: string;
}): StructuredLogContext => ({
  correlationId: options.bootstrapId,
  appVersion: options.appVersion,
  userDataPath: options.userDataPath
});

export const createBootstrapLogRecord = (
  input: CreateBootstrapLogRecordInput
): StructuredLogRecord =>
  createBaseStructuredLogRecord({
    source: "desktop",
    scope: input.scope,
    level: input.level,
    message: input.message,
    context: input.context,
    baseContext: toBaseContext({
      bootstrapId: input.bootstrapId,
      appVersion: input.appVersion,
      userDataPath: input.userDataPath
    }),
    clock: input.clock
  });

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

export const createBootstrapLogger = (
  options: CreateBootstrapLoggerOptions
): BootstrapLoggerBundle => {
  const paths = {
    logDirectory: join(options.userDataPath, "logs"),
    desktopLogPath: join(options.userDataPath, "logs", "desktop-bootstrap.ndjson"),
    serverLogPath: join(options.userDataPath, "logs", "server-bootstrap.ndjson")
  };
  const writeLine = options.writeLine ?? defaultWriteLine;
  const bootstrapLogger = createStructuredLogger({
    source: "desktop",
    scope: "bootstrap",
    logFilePath: paths.desktopLogPath,
    baseContext: toBaseContext(options),
    clock: options.clock,
    writeLine
  });

  return {
    bootstrapLogger,
    localServerLogger: bootstrapLogger.child("local-server"),
    shutdownLogger: bootstrapLogger.child("shutdown"),
    paths
  };
};
