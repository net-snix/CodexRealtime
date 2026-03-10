import { app, BrowserWindow, dialog } from "electron";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { realpathSync } from "node:fs";
import type {
  ApprovalDecision,
  ThreadChangeSummary,
  ThreadSummary,
  TimelineState,
  TurnStartRequest,
  WorkerAttachment,
  WorkerExecutionSettings,
  WorkerModelOption,
  WorkerSettingsState,
  WorkspaceProject,
  WorkspaceState,
  WorkspaceSummary
} from "@shared";
import { codexBridge } from "./codex-bridge";
import {
  buildWorkerInputs,
  getSelectedWorkerModel,
  mapWorkerModel,
  resolveWorkerSettings,
  supportsImageAttachments,
  toWorkerAttachment,
  workerSettingsFromConfig
} from "./worker-settings";
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

type ConfigReadResult = {
  config?: {
    model?: string | null;
    model_reasoning_effort?: WorkerExecutionSettings["reasoningEffort"] | null;
    approval_policy?: WorkerExecutionSettings["approvalPolicy"] | null;
    service_tier?: "fast" | "flex" | null;
  };
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

type ModelListResult = {
  data?: unknown[];
  nextCursor?: string | null;
};

const EMPTY_STATE: PersistedState = {
  currentWorkspaceId: null,
  workspaces: {}
};

const THREAD_CHANGE_SUMMARY_LIMIT = 6;

const now = () => new Date().toISOString();

const formatUpdatedAt = (updatedAt?: number) => {
  if (!updatedAt) {
    return "Unknown";
  }

  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - updatedAt);

  if (seconds < 60) {
    return "now";
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `${days}d`;
  }

  return `${Math.floor(days / 7)}w`;
};

const toWorkspaceSummary = (workspace: PersistedWorkspace): WorkspaceSummary => ({
  id: workspace.id,
  name: workspace.name,
  path: workspace.path
});

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
  let timeoutId: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const DIFF_METADATA_PREFIXES = [
  "diff --git",
  "index ",
  "@@",
  "---",
  "+++",
  "new file mode",
  "deleted file mode",
  "rename from",
  "rename to",
  "similarity index"
];

const countDiffLines = (diff: string): ThreadChangeSummary => {
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split("\n")) {
    if (!line) {
      continue;
    }

    if (DIFF_METADATA_PREFIXES.some((prefix) => line.startsWith(prefix))) {
      continue;
    }

    if (line.startsWith("+")) {
      additions += 1;
      continue;
    }

    if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  return { additions, deletions };
};

const summarizeThreadChanges = (turns: TurnRecord[]): ThreadChangeSummary | null => {
  const isFileChangeItem = (
    item: unknown
  ): item is { type: "fileChange"; changes?: Array<{ diff?: string }> } =>
    Boolean(item) &&
    typeof item === "object" &&
    item !== null &&
    "type" in item &&
    (item as { type?: unknown }).type === "fileChange" &&
    "changes" in item;

  for (const turn of [...turns].reverse()) {
    let additions = 0;
    let deletions = 0;
    let sawFileChange = false;

    for (const item of turn.items ?? []) {
      if (!isFileChangeItem(item) || !Array.isArray(item.changes)) {
        continue;
      }

      sawFileChange = true;

      for (const change of item.changes) {
        const diff = typeof change.diff === "string" ? change.diff : "";
        const counts = countDiffLines(diff);
        additions += counts.additions;
        deletions += counts.deletions;
      }
    }

    if (sawFileChange) {
      return additions > 0 || deletions > 0 ? { additions, deletions } : null;
    }
  }

  return null;
};

const restoreWindowFocus = (window: BrowserWindow | null | undefined) => {
  if (!window || window.isDestroyed()) {
    return;
  }

  app.focus({ steal: true });
  window.show();
  window.focus();
  window.webContents.focus();

  for (const delay of [60, 240]) {
    setTimeout(() => {
      if (window.isDestroyed()) {
        return;
      }

      app.focus({ steal: true });
      window.focus();
      window.webContents.focus();
    }, delay);
  }
};

class WorkspaceService {
  private liveTimelineState = emptyTimelineState();
  private activeTurnId: string | null = null;
  private readonly threadChangeCache = new Map<string, ThreadChangeSummary | null>();
  private workerModelsCache: WorkerModelOption[] | null = null;
  private readonly workerSettingsByThread = new Map<string, WorkerExecutionSettings>();
  private readonly workerDraftSettingsByWorkspace = new Map<string, WorkerExecutionSettings>();

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
    const recentWorkspaces = this.listRecentWorkspaces(persisted);
    const projects = await this.listWorkspaceProjects(recentWorkspaces, persisted);
    const currentProject = projects.find((project) => project.isCurrent) ?? null;

    return {
      currentWorkspace: currentProject
        ? {
            id: currentProject.id,
            name: currentProject.name,
            path: currentProject.path
          }
        : null,
      currentThreadId: currentProject?.currentThreadId ?? null,
      recentWorkspaces: recentWorkspaces.map(toWorkspaceSummary),
      threads: currentProject?.threads ?? [],
      projects
    };
  }

  async getWorkerSettingsState(): Promise<WorkerSettingsState> {
    const models = await this.loadWorkerModels().catch(() => []);
    const settings = await this.resolveActiveWorkerSettings(models);

    return {
      settings,
      models
    };
  }

  async updateWorkerSettings(
    patch: Partial<WorkerExecutionSettings>
  ): Promise<WorkerSettingsState> {
    const models = await this.loadWorkerModels().catch(() => []);
    const currentSettings = await this.resolveActiveWorkerSettings(models);
    const nextSettings = resolveWorkerSettings(
      {
        ...currentSettings,
        ...patch
      },
      models
    );
    const persisted = this.readState();
    const workspace = persisted.currentWorkspaceId
      ? persisted.workspaces[persisted.currentWorkspaceId]
      : null;

    if (workspace?.threadId) {
      this.workerSettingsByThread.set(workspace.threadId, nextSettings);
    } else if (workspace) {
      this.workerDraftSettingsByWorkspace.set(workspace.id, nextSettings);
    }

    return {
      settings: nextSettings,
      models
    };
  }

  async pickWorkerAttachments(): Promise<WorkerAttachment[]> {
    const parentWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const persisted = this.readState();
    const defaultPath = persisted.currentWorkspaceId
      ? persisted.workspaces[persisted.currentWorkspaceId]?.path
      : process.cwd();
    const picked = await dialog.showOpenDialog({
      title: "Attach files",
      defaultPath,
      properties: ["openFile", "multiSelections"]
    });
    restoreWindowFocus(parentWindow);

    if (picked.canceled || picked.filePaths.length === 0) {
      return [];
    }

    return picked.filePaths.map(toWorkerAttachment);
  }

  async openWorkspace(): Promise<WorkspaceState> {
    const parentWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const picked = await dialog.showOpenDialog({
      title: "Open repository",
      properties: ["openDirectory", "createDirectory"]
    });
    restoreWindowFocus(parentWindow);

    if (picked.canceled || picked.filePaths.length === 0) {
      return this.getWorkspaceState();
    }

    return this.openWorkspacePath(picked.filePaths[0]);
  }

  async openCurrentWorkspace(): Promise<WorkspaceState> {
    return this.openWorkspacePath(process.cwd());
  }

  async selectWorkspace(workspaceId: string): Promise<WorkspaceState> {
    const persisted = this.readState();
    const workspace = persisted.workspaces[workspaceId];

    if (!workspace) {
      throw new Error("Workspace not found.");
    }

    workspace.lastOpenedAt = now();
    persisted.currentWorkspaceId = workspaceId;
    persisted.workspaces[workspaceId] = workspace;
    this.writeState(persisted);

    return this.getWorkspaceState();
  }

  async createThread(workspaceId: string): Promise<TimelineState> {
    const persisted = this.readState();
    const workspace = persisted.workspaces[workspaceId];

    if (!workspace) {
      throw new Error("Workspace not found.");
    }

    const started = (await codexBridge.startThread(workspace.path)) as {
      thread?: { id?: string };
    };

    if (!started.thread?.id) {
      throw new Error("Codex did not return a thread id");
    }

    persisted.currentWorkspaceId = workspace.id;
    workspace.threadId = started.thread.id;
    workspace.lastOpenedAt = now();
    persisted.workspaces[workspace.id] = workspace;
    this.writeState(persisted);

    this.activeTurnId = null;
    this.workerDraftSettingsByWorkspace.delete(workspace.id);
    this.liveTimelineState = {
      ...emptyTimelineState(started.thread.id),
      statusLabel: "Idle"
    };

    return cloneTimelineState(this.liveTimelineState);
  }

  async selectThread(workspaceId: string, threadId: string): Promise<TimelineState> {
    const persisted = this.readState();
    const workspace = persisted.workspaces[workspaceId];

    if (!workspace) {
      throw new Error("Workspace not found.");
    }

    persisted.currentWorkspaceId = workspaceId;
    workspace.threadId = threadId;
    workspace.lastOpenedAt = now();
    persisted.workspaces[workspace.id] = workspace;
    this.writeState(persisted);

    this.liveTimelineState = await this.hydrateLiveTimeline(threadId);
    return cloneTimelineState(this.liveTimelineState);
  }

  private async openWorkspacePath(inputPath: string): Promise<WorkspaceState> {
    const workspacePath = this.resolveWorkspaceRoot(inputPath);
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

    const timeline = await withTimeout(
      this.readThreadTimeline(workspace.threadId),
      1500,
      null
    ).catch(() => null);

    if (!timeline) {
      return {
        ...emptyTimelineState(workspace.threadId),
        statusLabel: "History unavailable"
      };
    }

    this.liveTimelineState = cloneTimelineState(timeline);
    return timeline;
  }

  async startTurn(request: TurnStartRequest): Promise<TimelineState> {
    const trimmedPrompt = request.prompt.trim();

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

    const hadThread = Boolean(workspace.threadId);
    const models = await this.loadWorkerModels().catch(() => []);
    const settings = await this.resolveWorkerSettingsForWorkspace(workspace, models);
    const selectedModel = getSelectedWorkerModel(settings, models);
    const input = buildWorkerInputs(
      trimmedPrompt,
      request.attachments,
      supportsImageAttachments(selectedModel?.model ?? null, models)
    );
    const threadId = await this.ensureThread(workspace);
    workspace.threadId = threadId;
    workspace.lastOpenedAt = now();
    persisted.workspaces[workspace.id] = workspace;
    this.writeState(persisted);
    this.liveTimelineState = await this.hydrateLiveTimeline(threadId);
    const started = (await codexBridge.startTurn(threadId, input, settings)) as {
      turn?: { id?: string };
    };
    if (!hadThread) {
      this.workerSettingsByThread.set(threadId, settings);
      this.workerDraftSettingsByWorkspace.delete(workspace.id);
    }
    this.activeTurnId = started.turn?.id ?? this.activeTurnId;
    this.liveTimelineState = {
      ...this.ensureLiveTimeline(threadId),
      isRunning: true,
      statusLabel: started.turn?.id ? "Working" : "Starting"
    };

    return cloneTimelineState(this.liveTimelineState);
  }

  async dispatchVoicePrompt(prompt: string): Promise<TimelineState> {
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

    if (!this.activeTurnId) {
      return this.startTurn({ prompt: trimmedPrompt, attachments: [] });
    }

    try {
      await codexBridge.steerTurn(threadId, this.activeTurnId, trimmedPrompt);
    } catch {
      this.activeTurnId = null;
      return this.startTurn({ prompt: trimmedPrompt, attachments: [] });
    }

    this.liveTimelineState = {
      ...this.ensureLiveTimeline(threadId),
      isRunning: true,
      statusLabel: "Steering"
    };

    return cloneTimelineState(this.liveTimelineState);
  }

  hasActiveTurn() {
    return Boolean(this.activeTurnId);
  }

  async interruptActiveTurn(): Promise<TimelineState> {
    if (!this.activeTurnId) {
      return this.getTimelineState();
    }

    const threadId = await this.getCurrentThreadId();
    const turnId = this.activeTurnId;

    await codexBridge.interruptTurn(threadId, turnId);
    this.activeTurnId = null;
    this.liveTimelineState = await this.hydrateLiveTimeline(threadId, {
      ...this.ensureLiveTimeline(threadId),
      isRunning: false,
      statusLabel: "Interrupted"
    });

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
    const turns = result.thread?.turns ?? [];
    this.activeTurnId = turns.find((turn) => turn.status === "inProgress")?.id ?? null;
    return buildTimelineState(threadId, turns);
  }

  private async listThreads(workspacePath: string): Promise<ThreadSummary[]> {
    try {
      await codexBridge.start();
      const result = (await codexBridge.listThreads(workspacePath)) as ThreadListResult;

      const threads: ThreadSummary[] = (result.data ?? []).map((thread) => ({
        id: thread.id ?? randomUUID(),
        title: thread.name ?? thread.preview ?? "Untitled thread",
        updatedAt: formatUpdatedAt(thread.updatedAt),
        changeSummary: null
      }));

      await Promise.all(
        threads.slice(0, THREAD_CHANGE_SUMMARY_LIMIT).map(async (thread) => {
          thread.changeSummary = await this.getThreadChangeSummary(thread.id);
        })
      );

      return threads;
    } catch {
      return [];
    }
  }

  private async listThreadsSnapshot(workspacePath: string): Promise<ThreadSummary[]> {
    return withTimeout(this.listThreads(workspacePath), 1500, []);
  }

  private async listWorkspaceProjects(
    workspaces: PersistedWorkspace[],
    state: PersistedState
  ): Promise<WorkspaceProject[]> {
    return Promise.all(
      workspaces.map(async (workspace) => {
        const threads = await this.listThreadsSnapshot(workspace.path);

        if (
          workspace.threadId &&
          !threads.some((thread) => thread.id === workspace.threadId)
        ) {
          threads.unshift({
            id: workspace.threadId,
            title: "New thread",
            updatedAt: "now",
            changeSummary: null
          });
        }

        return {
          ...toWorkspaceSummary(workspace),
          isCurrent: workspace.id === state.currentWorkspaceId,
          currentThreadId: workspace.threadId,
          threads
        };
      })
    );
  }

  private async getThreadChangeSummary(threadId: string): Promise<ThreadChangeSummary | null> {
    if (this.threadChangeCache.has(threadId)) {
      return this.threadChangeCache.get(threadId) ?? null;
    }

    const summary = await withTimeout(this.readThreadChangeSummary(threadId), 900, null).catch(
      () => null
    );
    this.threadChangeCache.set(threadId, summary);
    return summary;
  }

  private async readThreadChangeSummary(threadId: string): Promise<ThreadChangeSummary | null> {
    await codexBridge.start();
    const result = (await codexBridge.readThread(threadId)) as ThreadReadResult;
    return summarizeThreadChanges(result.thread?.turns ?? []);
  }

  private async loadWorkerModels(): Promise<WorkerModelOption[]> {
    if (this.workerModelsCache) {
      return this.workerModelsCache;
    }

    await codexBridge.start();

    const models: WorkerModelOption[] = [];
    let cursor: string | null = null;

    do {
      const result = (await codexBridge.listModels(cursor)) as ModelListResult;

      for (const entry of result.data ?? []) {
        if (!entry || typeof entry !== "object") {
          continue;
        }

        const model = mapWorkerModel(entry as Record<string, unknown>);

        if (model) {
          models.push(model);
        }
      }

      cursor = typeof result.nextCursor === "string" ? result.nextCursor : null;
    } while (cursor);

    this.workerModelsCache = models;
    return models;
  }

  private async readConfigWorkerSettings(cwd?: string | null): Promise<WorkerExecutionSettings> {
    try {
      await codexBridge.start();
      const result = (await codexBridge.readConfig(cwd ?? null)) as ConfigReadResult;
      return workerSettingsFromConfig(result.config);
    } catch {
      return workerSettingsFromConfig(null);
    }
  }

  private async resolveWorkerSettingsForWorkspace(
    workspace: PersistedWorkspace | null,
    models: WorkerModelOption[]
  ): Promise<WorkerExecutionSettings> {
    const configSettings = await this.readConfigWorkerSettings(workspace?.path ?? process.cwd());
    const threadSettings = workspace?.threadId
      ? this.workerSettingsByThread.get(workspace.threadId) ?? null
      : workspace
        ? this.workerDraftSettingsByWorkspace.get(workspace.id) ?? null
        : null;

    return resolveWorkerSettings(threadSettings ?? configSettings, models);
  }

  private async resolveActiveWorkerSettings(
    models: WorkerModelOption[]
  ): Promise<WorkerExecutionSettings> {
    const persisted = this.readState();
    const workspace = persisted.currentWorkspaceId
      ? persisted.workspaces[persisted.currentWorkspaceId] ?? null
      : null;

    return this.resolveWorkerSettingsForWorkspace(workspace, models);
  }

  private listRecentWorkspaces(state: PersistedState): PersistedWorkspace[] {
    return Object.values(state.workspaces)
      .sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt))
      .slice(0, 8);
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
      return {
        currentWorkspaceId: EMPTY_STATE.currentWorkspaceId,
        workspaces: {}
      };
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
    this.syncActiveTurnFromNotification(payload);
    this.invalidateThreadCache(payload);
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

  private syncActiveTurnFromNotification(payload: NotificationPayload) {
    const params = payload.params as { threadId?: unknown; turn?: { id?: unknown } } | undefined;
    const threadId = typeof params?.threadId === "string" ? params.threadId : null;

    if (!threadId || !this.isCurrentThread(threadId)) {
      return;
    }

    if (payload.method === "turn/started") {
      this.activeTurnId =
        params?.turn && typeof params.turn.id === "string" ? params.turn.id : this.activeTurnId;
      return;
    }

    if (payload.method === "turn/completed") {
      this.activeTurnId = null;
    }
  }

  private invalidateThreadCache(payload: NotificationPayload) {
    const params = payload.params as { threadId?: unknown } | undefined;
    const threadId = typeof params?.threadId === "string" ? params.threadId : null;

    if (!threadId) {
      return;
    }

    if (
      payload.method === "turn/started" ||
      payload.method === "turn/completed" ||
      payload.method === "turn/diff/updated" ||
      payload.method === "item/started" ||
      payload.method === "item/completed"
    ) {
      this.threadChangeCache.delete(threadId);
    }
  }
}

export const workspaceService = new WorkspaceService();
