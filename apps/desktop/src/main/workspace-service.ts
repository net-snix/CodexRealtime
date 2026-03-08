import { app, dialog } from "electron";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { realpathSync } from "node:fs";
import type { ThreadSummary, TimelineEvent, TimelineState, WorkspaceState, WorkspaceSummary } from "@shared";
import { codexBridge } from "./codex-bridge";

type PersistedWorkspace = WorkspaceSummary & {
  lastOpenedAt: string;
  threadId: string | null;
};

type PersistedState = {
  currentWorkspaceId: string | null;
  workspaces: Record<string, PersistedWorkspace>;
};

type ThreadListResult = {
  data?: Array<{
    id?: string;
    name?: string | null;
    preview?: string;
    updatedAt?: number;
  }>;
};

type ThreadItem =
  | {
      type: "userMessage";
      id?: string;
      content?: Array<{ type?: string; text?: string }>;
    }
  | {
      type: "agentMessage";
      id?: string;
      text?: string;
    }
  | {
      type: "plan";
      id?: string;
      text?: string;
    }
  | {
      type: "reasoning";
      id?: string;
      summary?: string[];
      content?: string[];
    }
  | {
      type: "commandExecution";
      id?: string;
      command?: string;
      aggregatedOutput?: string | null;
    }
  | {
      type: "fileChange";
      id?: string;
      changes?: Array<{ path?: string }>;
    }
  | {
      type: string;
      id?: string;
    };

type TurnRecord = {
  id?: string;
  status?: "completed" | "interrupted" | "failed" | "inProgress";
  items?: ThreadItem[];
};

type ThreadReadResult = {
  thread?: {
    id?: string;
    turns?: TurnRecord[];
  };
};

type UserMessageItem = Extract<ThreadItem, { type: "userMessage" }>;
type AgentMessageItem = Extract<ThreadItem, { type: "agentMessage" }>;
type PlanItem = Extract<ThreadItem, { type: "plan" }>;
type ReasoningItem = Extract<ThreadItem, { type: "reasoning" }>;
type CommandExecutionItem = Extract<ThreadItem, { type: "commandExecution" }>;
type FileChangeItem = Extract<ThreadItem, { type: "fileChange" }>;

const EMPTY_STATE: PersistedState = {
  currentWorkspaceId: null,
  workspaces: {}
};

const now = () => new Date().toISOString();

const formatUpdatedAt = (updatedAt?: number) => {
  if (!updatedAt) {
    return "Unknown";
  }

  return new Date(updatedAt * 1000).toLocaleString();
};

const toWorkspaceSummary = (workspace: PersistedWorkspace): WorkspaceSummary => ({
  id: workspace.id,
  name: workspace.name,
  path: workspace.path
});

const isUserMessage = (item: ThreadItem): item is UserMessageItem => item.type === "userMessage";
const isAgentMessage = (item: ThreadItem): item is AgentMessageItem => item.type === "agentMessage";
const isPlanItem = (item: ThreadItem): item is PlanItem => item.type === "plan";
const isReasoningItem = (item: ThreadItem): item is ReasoningItem => item.type === "reasoning";
const isCommandExecutionItem = (item: ThreadItem): item is CommandExecutionItem =>
  item.type === "commandExecution";
const isFileChangeItem = (item: ThreadItem): item is FileChangeItem => item.type === "fileChange";

const toTimelineEvent = (item: ThreadItem, turnId: string): TimelineEvent | null => {
  const base = {
    id: item.id ?? `${turnId}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: "Thread history"
  };

  if (isUserMessage(item)) {
    const text = (item.content ?? [])
      .filter((entry): entry is { type: "text"; text: string } =>
        entry.type === "text" && typeof entry.text === "string"
      )
      .map((entry) => entry.text.trim())
      .filter(Boolean)
      .join("\n");

    return text
      ? {
          ...base,
          kind: "user",
          text
        }
      : null;
  }

  if (isAgentMessage(item) && item.text) {
    return {
      ...base,
      kind: "assistant",
      text: item.text
    };
  }

  if (isPlanItem(item) && item.text) {
    return {
      ...base,
      kind: "commentary",
      text: `Plan update: ${item.text}`
    };
  }

  if (isReasoningItem(item)) {
    const text = [...(item.summary ?? []), ...(item.content ?? [])].filter(Boolean).join("\n");

    return text
      ? {
          ...base,
          kind: "commentary",
          text
        }
      : null;
  }

  if (isCommandExecutionItem(item) && item.command) {
    return {
      ...base,
      kind: "system",
      text: `Command: ${item.command}${item.aggregatedOutput ? `\n${item.aggregatedOutput}` : ""}`
    };
  }

  if (isFileChangeItem(item)) {
    const changeCount = item.changes?.length ?? 0;

    return {
      ...base,
      kind: "system",
      text: `File changes proposed: ${changeCount}`
    };
  }

  return null;
};

class WorkspaceService {
  private get statePath() {
    return join(app.getPath("userData"), "workspace-state.json");
  }

  async getWorkspaceState(): Promise<WorkspaceState> {
    const persisted = this.readState();
    const currentWorkspace =
      persisted.currentWorkspaceId && persisted.workspaces[persisted.currentWorkspaceId]
        ? persisted.workspaces[persisted.currentWorkspaceId]
        : null;

    return {
      currentWorkspace: currentWorkspace ? toWorkspaceSummary(currentWorkspace) : null,
      recentWorkspaces: this.listRecentWorkspaces(persisted),
      threads: currentWorkspace ? await this.listThreads(currentWorkspace.path) : []
    };
  }

  async openWorkspace(): Promise<WorkspaceState> {
    const picked = await dialog.showOpenDialog({
      title: "Open repository",
      properties: ["openDirectory", "createDirectory"]
    });

    if (picked.canceled || picked.filePaths.length === 0) {
      return this.getWorkspaceState();
    }

    const workspacePath = this.resolveWorkspaceRoot(picked.filePaths[0]);
    const persisted = this.readState();
    const workspaceId = workspacePath;
    const existing = persisted.workspaces[workspaceId];
    const workspace: PersistedWorkspace = {
      id: workspaceId,
      name: basename(workspacePath),
      path: workspacePath,
      lastOpenedAt: now(),
      threadId: existing?.threadId ?? null
    };

    const threadId = await this.ensureThread(workspace);
    workspace.threadId = threadId;
    workspace.lastOpenedAt = now();

    persisted.workspaces[workspaceId] = workspace;
    persisted.currentWorkspaceId = workspaceId;
    this.writeState(persisted);

    return this.getWorkspaceState();
  }

  async restoreLastWorkspace(): Promise<WorkspaceState> {
    const persisted = this.readState();

    if (!persisted.currentWorkspaceId) {
      return this.getWorkspaceState();
    }

    const workspace = persisted.workspaces[persisted.currentWorkspaceId];

    if (!workspace) {
      return this.getWorkspaceState();
    }

    try {
      await this.ensureThread(workspace);
    } catch {
      // Keep the persisted workspace visible even if thread resume fails on boot.
    }

    return this.getWorkspaceState();
  }

  async getTimelineState(): Promise<TimelineState> {
    const persisted = this.readState();

    if (!persisted.currentWorkspaceId) {
      return {
        threadId: null,
        events: [],
        isRunning: false,
        statusLabel: null
      };
    }

    const workspace = persisted.workspaces[persisted.currentWorkspaceId];

    if (!workspace?.threadId) {
      return {
        threadId: null,
        events: [],
        isRunning: false,
        statusLabel: null
      };
    }

    try {
      const timeline = await this.readThreadTimeline(workspace.threadId);
      return timeline;
    } catch {
      return {
        threadId: workspace.threadId,
        events: [],
        isRunning: false,
        statusLabel: "History unavailable"
      };
    }
  }

  async startTurn(prompt: string): Promise<TimelineState> {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt) {
      return this.getTimelineState();
    }

    const persisted = this.readState();

    if (!persisted.currentWorkspaceId) {
      throw new Error("Open a workspace first.");
    }

    const workspace = persisted.workspaces[persisted.currentWorkspaceId];

    if (!workspace) {
      throw new Error("Current workspace is missing.");
    }

    const threadId = await this.ensureThread(workspace);
    workspace.threadId = threadId;
    workspace.lastOpenedAt = now();
    persisted.workspaces[workspace.id] = workspace;
    this.writeState(persisted);

    const started = (await codexBridge.startTurn(threadId, trimmedPrompt)) as {
      turn?: { id?: string };
    };
    const startedTurnId = started.turn?.id ?? null;

    return this.pollTimelineState(threadId, startedTurnId);
  }

  private async ensureThread(workspace: PersistedWorkspace) {
    await codexBridge.start();

    if (workspace.threadId) {
      try {
        const resumed = (await codexBridge.resumeThread(workspace.threadId, workspace.path)) as {
          thread?: { id?: string };
        };

        if (resumed.thread?.id) {
          return resumed.thread.id;
        }
      } catch {
        // Fall through to a fresh thread start.
      }
    }

    const started = (await codexBridge.startThread(workspace.path)) as {
      thread?: { id?: string };
    };

    if (!started.thread?.id) {
      throw new Error("Codex did not return a thread id");
    }

    return started.thread.id;
  }

  private async readThreadTimeline(threadId: string): Promise<TimelineState> {
    await codexBridge.start();
    const result = (await codexBridge.readThread(threadId)) as ThreadReadResult;
    const turns = result.thread?.turns ?? [];
    const events = turns.flatMap((turn) =>
      (turn.items ?? [])
        .map((item) => toTimelineEvent(item, turn.id ?? "turn"))
        .filter((event): event is TimelineEvent => event !== null)
    );
    const activeTurn = turns.find((turn) => turn.status === "inProgress") ?? null;

    return {
      threadId,
      events,
      isRunning: Boolean(activeTurn),
      statusLabel: activeTurn ? "Working" : turns.at(-1)?.status ?? "Idle"
    };
  }

  private async pollTimelineState(threadId: string, turnId: string | null): Promise<TimelineState> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const timeline = await this.readThreadTimeline(threadId);

      if (!timeline.isRunning) {
        return timeline;
      }

      if (turnId) {
        const result = (await codexBridge.readThread(threadId)) as ThreadReadResult;
        const turns = result.thread?.turns ?? [];
        const matchingTurn = turns.find((turn) => turn.id === turnId) ?? null;

        if (!matchingTurn || matchingTurn.status !== "inProgress") {
          return this.readThreadTimeline(threadId);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    return this.readThreadTimeline(threadId);
  }

  private async listThreads(workspacePath: string): Promise<ThreadSummary[]> {
    try {
      await codexBridge.start();
      const result = (await codexBridge.listThreads(workspacePath)) as ThreadListResult;

      return (result.data ?? []).map((thread) => ({
        id: thread.id ?? randomUUID(),
        title: thread.name ?? thread.preview ?? "Untitled thread",
        updatedAt: formatUpdatedAt(thread.updatedAt)
      }));
    } catch {
      return [];
    }
  }

  private listRecentWorkspaces(state: PersistedState): WorkspaceSummary[] {
    return Object.values(state.workspaces)
      .sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt))
      .slice(0, 8)
      .map(toWorkspaceSummary);
  }

  private readState(): PersistedState {
    try {
      const raw = readFileSync(this.statePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedState;

      return {
        currentWorkspaceId: parsed.currentWorkspaceId ?? null,
        workspaces: parsed.workspaces ?? {}
      };
    } catch {
      return EMPTY_STATE;
    }
  }

  private writeState(state: PersistedState) {
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(this.statePath, JSON.stringify(state, null, 2));
  }

  private resolveWorkspaceRoot(inputPath: string) {
    const realPath = realpathSync(inputPath);

    try {
      const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: realPath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();

      return gitRoot || realPath;
    } catch {
      return realPath;
    }
  }
}

export const workspaceService = new WorkspaceService();
