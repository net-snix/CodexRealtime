import { app, dialog } from "electron";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { realpathSync } from "node:fs";
import type {
  ThreadSummary,
  TimelineApproval,
  TimelineEvent,
  TimelinePlanStep,
  TimelineState,
  TimelineUserInputRequest,
  WorkspaceState,
  WorkspaceSummary
} from "@shared";
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
type ThreadRef = { id?: string };
type TurnRef = ThreadRef & {
  status?: "completed" | "interrupted" | "failed" | "inProgress";
};
type NotificationPayload = {
  method: string;
  params?: unknown;
};
type RequestPayload = {
  id: string;
  method: string;
  params?: unknown;
};

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
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";
const emptyTimelineState = (threadId: string | null = null): TimelineState => ({
  threadId,
  events: [],
  planSteps: [],
  diff: "",
  approvals: [],
  userInputs: [],
  isRunning: false,
  statusLabel: null
});
const cloneTimelineState = (state: TimelineState): TimelineState => ({
  ...state,
  events: [...state.events],
  planSteps: [...state.planSteps],
  approvals: [...state.approvals],
  userInputs: [...state.userInputs]
});

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
  private liveTimelineState = emptyTimelineState();

  constructor() {
    codexBridge.on("notification", (payload: NotificationPayload) => {
      void this.handleBridgeNotification(payload);
    });
    codexBridge.on("serverRequest", (payload: RequestPayload) => {
      this.handleBridgeRequest(payload);
    });
  }

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
      return emptyTimelineState();
    }

    const workspace = persisted.workspaces[persisted.currentWorkspaceId];

    if (!workspace?.threadId) {
      return emptyTimelineState();
    }

    if (this.liveTimelineState.threadId === workspace.threadId) {
      return cloneTimelineState(this.liveTimelineState);
    }

    try {
      const timeline = await this.readThreadTimeline(workspace.threadId);
      this.liveTimelineState = cloneTimelineState(timeline);
      return timeline;
    } catch {
      return {
        ...emptyTimelineState(workspace.threadId),
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
    this.liveTimelineState = await this.hydrateLiveTimeline(threadId);

    const started = (await codexBridge.startTurn(threadId, trimmedPrompt)) as {
      turn?: { id?: string };
    };
    this.liveTimelineState = {
      ...this.ensureLiveTimeline(threadId),
      isRunning: true,
      statusLabel: started.turn?.id ? "Working" : "Starting"
    };

    return cloneTimelineState(this.liveTimelineState);
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
      planSteps: [],
      diff: "",
      approvals: [],
      userInputs: [],
      isRunning: Boolean(activeTurn),
      statusLabel: activeTurn ? "Working" : turns.at(-1)?.status ?? "Idle"
    };
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

  private async handleBridgeNotification(payload: NotificationPayload) {
    const params = isRecord(payload.params) ? payload.params : {};
    const threadId = typeof params.threadId === "string" ? params.threadId : null;

    if (!threadId || !this.isCurrentThread(threadId)) {
      return;
    }

    switch (payload.method) {
      case "turn/started": {
        const turn = isRecord(params.turn) ? (params.turn as TurnRef) : null;
        this.liveTimelineState = {
          ...this.ensureLiveTimeline(threadId),
          isRunning: true,
          statusLabel: turn?.id ? "Working" : "Starting"
        };
        return;
      }

      case "turn/plan/updated": {
        const planSteps = Array.isArray(params.plan)
          ? params.plan
              .map((entry) =>
                isRecord(entry) && typeof entry.step === "string"
                  ? {
                      step: entry.step,
                      status: typeof entry.status === "string" ? entry.status : "pending"
                    }
                  : null
              )
              .filter((entry): entry is TimelinePlanStep => entry !== null)
          : [];
        const explanation =
          typeof params.explanation === "string" ? params.explanation.trim() : "";
        const nextState = this.ensureLiveTimeline(threadId);
        nextState.planSteps = planSteps;

        if (explanation) {
          this.upsertTimelineEvent(nextState, {
            id: `plan-${threadId}`,
            kind: "commentary",
            text: explanation,
            createdAt: "Live update"
          });
        }

        this.liveTimelineState = cloneTimelineState(nextState);
        return;
      }

      case "turn/diff/updated": {
        const diff = typeof params.diff === "string" ? params.diff : "";
        this.liveTimelineState = {
          ...this.ensureLiveTimeline(threadId),
          diff
        };
        return;
      }

      case "item/started":
      case "item/completed": {
        const item = isRecord(params.item) ? (params.item as ThreadItem) : null;
        const turnId = typeof params.turnId === "string" ? params.turnId : "turn";

        if (!item) {
          return;
        }

        const event = toTimelineEvent(item, turnId);

        if (!event) {
          return;
        }

        const nextState = this.ensureLiveTimeline(threadId);
        this.upsertTimelineEvent(nextState, {
          ...event,
          createdAt: payload.method === "item/started" ? "Live start" : "Live update"
        });
        this.liveTimelineState = cloneTimelineState(nextState);
        return;
      }

      case "item/agentMessage/delta": {
        const itemId = typeof params.itemId === "string" ? params.itemId : randomUUID();
        const delta = typeof params.delta === "string" ? params.delta : "";

        if (!delta) {
          return;
        }

        const nextState = this.ensureLiveTimeline(threadId);
        const existingIndex = nextState.events.findIndex((event) => event.id === itemId);

        if (existingIndex >= 0) {
          const existing = nextState.events[existingIndex];
          nextState.events[existingIndex] = {
            ...existing,
            text: `${existing.text}${delta}`,
            createdAt: "Streaming"
          };
        } else {
          nextState.events.push({
            id: itemId,
            kind: "assistant",
            text: delta,
            createdAt: "Streaming"
          });
        }

        this.liveTimelineState = cloneTimelineState(nextState);
        return;
      }

      case "serverRequest/resolved": {
        const requestId = typeof params.requestId === "string" ? params.requestId : null;

        if (!requestId) {
          return;
        }

        const nextState = this.ensureLiveTimeline(threadId);
        nextState.approvals = nextState.approvals.filter((approval) => approval.id !== requestId);
        nextState.userInputs = nextState.userInputs.filter((request) => request.id !== requestId);
        this.liveTimelineState = cloneTimelineState(nextState);
        return;
      }

      case "turn/completed": {
        const turn = isRecord(params.turn) ? (params.turn as TurnRef) : null;
        this.liveTimelineState = {
          ...this.ensureLiveTimeline(threadId),
          isRunning: false,
          statusLabel: turn?.status ?? "completed"
        };
        this.liveTimelineState = await this.hydrateLiveTimeline(threadId);
        return;
      }

      default:
        return;
    }
  }

  private handleBridgeRequest(payload: RequestPayload) {
    const params = isRecord(payload.params) ? payload.params : {};
    const threadId = typeof params.threadId === "string" ? params.threadId : null;

    if (!threadId || !this.isCurrentThread(threadId)) {
      return;
    }

    const nextState = this.ensureLiveTimeline(threadId);

    if (payload.method === "item/commandExecution/requestApproval") {
      const command = typeof params.command === "string" ? params.command.trim() : "";
      const cwd = typeof params.cwd === "string" ? params.cwd.trim() : "";
      const reason = typeof params.reason === "string" ? params.reason.trim() : "";

      this.upsertApproval(nextState, {
        id: payload.id,
        kind: "command",
        title: command ? `Run command: ${command}` : "Run command",
        detail: [cwd ? `cwd: ${cwd}` : null, reason || null].filter(Boolean).join("\n")
      });
    }

    if (payload.method === "item/fileChange/requestApproval") {
      const reason = typeof params.reason === "string" ? params.reason.trim() : "";
      const grantRoot = typeof params.grantRoot === "string" ? params.grantRoot.trim() : "";

      this.upsertApproval(nextState, {
        id: payload.id,
        kind: "fileChange",
        title: "Apply file changes",
        detail: [reason || null, grantRoot ? `grant root: ${grantRoot}` : null]
          .filter(Boolean)
          .join("\n")
      });
    }

    if (payload.method === "item/tool/requestUserInput") {
      const questions = Array.isArray(params.questions)
        ? params.questions
            .map((question) => {
              if (!isRecord(question)) {
                return null;
              }

              if (typeof question.question === "string") {
                return question.question;
              }

              if (typeof question.header === "string") {
                return question.header;
              }

              return null;
            })
            .filter((question): question is string => Boolean(question))
        : [];

      this.upsertUserInput(nextState, {
        id: payload.id,
        title: "Clarification requested",
        questions
      });
    }

    this.liveTimelineState = cloneTimelineState(nextState);
  }

  private async hydrateLiveTimeline(threadId: string): Promise<TimelineState> {
    const snapshot = await this.readThreadTimeline(threadId);
    const existing = this.liveTimelineState.threadId === threadId ? this.liveTimelineState : null;

    this.liveTimelineState = {
      ...snapshot,
      planSteps: existing?.planSteps ?? [],
      diff: existing?.diff ?? "",
      approvals: existing?.approvals ?? [],
      userInputs: existing?.userInputs ?? []
    };

    return cloneTimelineState(this.liveTimelineState);
  }

  private ensureLiveTimeline(threadId: string) {
    if (this.liveTimelineState.threadId !== threadId) {
      this.liveTimelineState = emptyTimelineState(threadId);
    }

    return this.liveTimelineState;
  }

  private isCurrentThread(threadId: string) {
    const state = this.readState();

    if (!state.currentWorkspaceId) {
      return false;
    }

    return state.workspaces[state.currentWorkspaceId]?.threadId === threadId;
  }

  private upsertTimelineEvent(state: TimelineState, event: TimelineEvent) {
    const index = state.events.findIndex((entry) => entry.id === event.id);

    if (index >= 0) {
      state.events[index] = event;
      return;
    }

    state.events.push(event);
  }

  private upsertApproval(state: TimelineState, approval: TimelineApproval) {
    const index = state.approvals.findIndex((entry) => entry.id === approval.id);

    if (index >= 0) {
      state.approvals[index] = approval;
      return;
    }

    state.approvals.push(approval);
  }

  private upsertUserInput(state: TimelineState, request: TimelineUserInputRequest) {
    const index = state.userInputs.findIndex((entry) => entry.id === request.id);

    if (index >= 0) {
      state.userInputs[index] = request;
      return;
    }

    state.userInputs.push(request);
  }
}

export const workspaceService = new WorkspaceService();
