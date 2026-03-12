import { execFileSync } from "node:child_process";

export type ProcessSnapshot = {
  pid: number;
  ppid: number;
  elapsedSeconds: number;
  command: string;
};

type DescendantProcess = ProcessSnapshot & {
  depth: number;
};

type HelperKind = "playwright" | "xcodebuild";

export type HelperCleanupResult = {
  found: number;
  killed: number;
};

type CleanupOptions = {
  minimumAgeSeconds?: number;
  retainPerKind?: number;
};

const PS_ARGS = ["-Ao", "pid=,ppid=,etime=,command="];
const HELPER_PATTERNS: Record<HelperKind, RegExp> = {
  playwright: /(?:^|\s|\/)playwright-mcp(?:\s|$)/,
  xcodebuild: /(?:^|\s|\/)xcodebuildmcp(?:\s|$)/
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const parseElapsedSeconds = (value: string): number | null => {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const [dayPart, clockPart] = trimmed.includes("-") ? trimmed.split("-", 2) : [null, trimmed];
  const clockSegments = clockPart.split(":").map((segment) => Number.parseInt(segment, 10));

  if (clockSegments.some((segment) => Number.isNaN(segment))) {
    return null;
  }

  const days = dayPart ? Number.parseInt(dayPart, 10) : 0;

  if (Number.isNaN(days)) {
    return null;
  }

  if (clockSegments.length === 2) {
    const [minutes, seconds] = clockSegments;
    return days * 86_400 + minutes * 60 + seconds;
  }

  if (clockSegments.length === 3) {
    const [hours, minutes, seconds] = clockSegments;
    return days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
  }

  return null;
};

export const parseProcessSnapshotLine = (line: string): ProcessSnapshot | null => {
  const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);

  if (!match) {
    return null;
  }

  const pid = Number.parseInt(match[1], 10);
  const ppid = Number.parseInt(match[2], 10);
  const elapsedSeconds = parseElapsedSeconds(match[3]);

  if (Number.isNaN(pid) || Number.isNaN(ppid) || elapsedSeconds === null) {
    return null;
  }

  return {
    pid,
    ppid,
    elapsedSeconds,
    command: match[4]
  };
};

export const parseProcessSnapshotTable = (table: string): ProcessSnapshot[] =>
  table
    .split("\n")
    .map((line) => parseProcessSnapshotLine(line))
    .filter((entry): entry is ProcessSnapshot => Boolean(entry));

export const collectDescendantProcesses = (
  processes: ProcessSnapshot[],
  rootPid: number
): DescendantProcess[] => {
  const byParent = new Map<number, ProcessSnapshot[]>();

  for (const process of processes) {
    const siblings = byParent.get(process.ppid);

    if (siblings) {
      siblings.push(process);
      continue;
    }

    byParent.set(process.ppid, [process]);
  }

  const descendants: DescendantProcess[] = [];
  const stack = (byParent.get(rootPid) ?? []).map((process) => ({ process, depth: 1 }));

  while (stack.length > 0) {
    const next = stack.pop();

    if (!next) {
      continue;
    }

    descendants.push({
      ...next.process,
      depth: next.depth
    });

    for (const child of byParent.get(next.process.pid) ?? []) {
      stack.push({
        process: child,
        depth: next.depth + 1
      });
    }
  }

  return descendants;
};

const classifyHelperKind = (command: string): HelperKind | null => {
  if (HELPER_PATTERNS.playwright.test(command)) {
    return "playwright";
  }

  if (HELPER_PATTERNS.xcodebuild.test(command)) {
    return "xcodebuild";
  }

  return null;
};

export const selectStaleHelperProcesses = (
  processes: ProcessSnapshot[],
  rootPid: number,
  options?: CleanupOptions
) => {
  const minimumAgeSeconds = options?.minimumAgeSeconds ?? 45;
  const retainPerKind = options?.retainPerKind ?? 1;
  const descendants = collectDescendantProcesses(processes, rootPid);
  const helpersByKind = new Map<HelperKind, DescendantProcess[]>();

  for (const process of descendants) {
    const kind = classifyHelperKind(process.command);

    if (!kind) {
      continue;
    }

    const helpers = helpersByKind.get(kind);

    if (helpers) {
      helpers.push(process);
      continue;
    }

    helpersByKind.set(kind, [process]);
  }

  const found = [...helpersByKind.values()].reduce((count, helpers) => count + helpers.length, 0);
  const stale: DescendantProcess[] = [];

  for (const helpers of helpersByKind.values()) {
    const candidates = [...helpers].sort((left, right) => {
      if (left.elapsedSeconds !== right.elapsedSeconds) {
        return left.elapsedSeconds - right.elapsedSeconds;
      }

      return right.pid - left.pid;
    });

    stale.push(
      ...candidates
        .slice(retainPerKind)
        .filter((process) => process.elapsedSeconds >= minimumAgeSeconds)
    );
  }

  return {
    found,
    stale
  };
};

const readProcessSnapshot = () =>
  parseProcessSnapshotTable(
    execFileSync("ps", PS_ARGS, {
      encoding: "utf8"
    })
  );

const signalProcesses = (pids: number[], signal: NodeJS.Signals) => {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // Ignore races with processes that already exited.
    }
  }
};

export const terminateProcessTree = async (rootPid: number) => {
  if (process.platform === "win32") {
    try {
      process.kill(rootPid, "SIGTERM");
    } catch {
      // Ignore races with processes that already exited.
    }
    return;
  }

  const descendants = collectDescendantProcesses(readProcessSnapshot(), rootPid)
    .sort((left, right) => right.depth - left.depth || right.pid - left.pid)
    .map((process) => process.pid);
  const trackedPids = new Set([...descendants, rootPid]);

  signalProcesses(descendants, "SIGTERM");
  signalProcesses([rootPid], "SIGTERM");
  await sleep(250);

  const remaining = readProcessSnapshot()
    .map((process) => process.pid)
    .filter((pid) => trackedPids.has(pid));

  if (remaining.length > 0) {
    signalProcesses(remaining, "SIGKILL");
  }
};

export const cleanupStaleHelperProcesses = async (
  rootPid: number,
  options?: CleanupOptions
): Promise<HelperCleanupResult> => {
  if (process.platform === "win32") {
    return { found: 0, killed: 0 };
  }

  const snapshot = readProcessSnapshot();
  const selection = selectStaleHelperProcesses(snapshot, rootPid, options);
  const stalePids = selection.stale.map((process) => process.pid);

  if (stalePids.length === 0) {
    return {
      found: selection.found,
      killed: 0
    };
  }

  signalProcesses(stalePids, "SIGTERM");
  await sleep(250);

  const remainingPids = readProcessSnapshot()
    .map((process) => process.pid)
    .filter((pid) => stalePids.includes(pid));

  if (remainingPids.length > 0) {
    signalProcesses(remainingPids, "SIGKILL");
  }

  return {
    found: selection.found,
    killed: stalePids.length
  };
};
