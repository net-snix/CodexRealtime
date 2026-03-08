import { app, dialog } from "electron";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { realpathSync } from "node:fs";
import type { ApprovalDecision, ThreadSummary, TimelineState, WorkspaceState, WorkspaceSummary } from "@shared";
import { codexBridge } from "./codex-bridge";
import {
  applyBridgeNotification,
  applyBridgeRequest,
  buildTimelineState,
  cloneTimelineState,
  emptyTimelineState,
  markApprovalSubmitting,
  markUserInputSubmitting,
  type NotificationPayload,
  type RequestPayload,
  type TurnRecord
} from "./workspace-timeline";

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

type ThreadReadResult = {
  thread?: {
    id?: string;
    turns?: TurnRecord[];
  };
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

  async getCurrentThreadId(): Promise<string> {
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

    return threadId;
  }

  async respondToApproval(
    requestId: string,
    decision: ApprovalDecision
  ): Promise<TimelineState> {
    const approval = this.liveTimelineState.approvals.find((entry) => entry.id === requestId);

    if (!approval) {
      throw new Error("Approval request no longer exists.");
    }

    if (!approval.availableDecisions.includes(decision)) {
      throw new Error(`Decision ${decision} is not available for this request.`);
    }

    this.liveTimelineState = markApprovalSubmitting(this.liveTimelineState, requestId, true);

    try {
      await codexBridge.respond(requestId, { decision });
      return cloneTimelineState(this.liveTimelineState);
    } catch (error) {
      this.liveTimelineState = markApprovalSubmitting(this.liveTimelineState, requestId, false);
      throw error;
    }
  }

  async submitUserInput(
    requestId: string,
    answers: Record<string, string | string[]>
  ): Promise<TimelineState> {
    const request = this.liveTimelineState.userInputs.find((entry) => entry.id === requestId);

    if (!request) {
      throw new Error("Clarification request no longer exists.");
    }

    const normalizedAnswers = Object.fromEntries(
      request.questions.map((question) => {
        const rawValue = answers[question.id];
        const values = (Array.isArray(rawValue) ? rawValue : [rawValue ?? ""])
          .map((value) => `${value}`.trim())
          .filter(Boolean);

        if (values.length === 0) {
          throw new Error(`Answer required for ${question.header}.`);
        }

        return [question.id, { answers: values }];
      })
    );

    this.liveTimelineState = markUserInputSubmitting(this.liveTimelineState, requestId, true);

    try {
      await codexBridge.respond(requestId, { answers: normalizedAnswers });
      return cloneTimelineState(this.liveTimelineState);
    } catch (error) {
      this.liveTimelineState = markUserInputSubmitting(this.liveTimelineState, requestId, false);
      throw error;
    }
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
    return buildTimelineState(threadId, result.thread?.turns ?? []);
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
    this.liveTimelineState = await applyBridgeNotification(
      this.liveTimelineState,
      payload,
      (threadId) => this.isCurrentThread(threadId),
      (threadId, currentState) => this.hydrateLiveTimeline(threadId, currentState)
    );
  }

  private handleBridgeRequest(payload: RequestPayload) {
    this.liveTimelineState = applyBridgeRequest(
      this.liveTimelineState,
      payload,
      (threadId) => this.isCurrentThread(threadId)
    );
  }

  private async hydrateLiveTimeline(
    threadId: string,
    currentState: TimelineState = this.liveTimelineState
  ): Promise<TimelineState> {
    const snapshot = await this.readThreadTimeline(threadId);
    const existing = currentState.threadId === threadId ? currentState : null;

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
}

export const workspaceService = new WorkspaceService();
