import { app, BrowserWindow, dialog } from "electron";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { realpathSync } from "node:fs";
import type {
  ArchiveThreadResult,
  ApprovalDecision,
  PastedImageAttachment,
  ThreadChangeSummary,
  ThreadSummary,
  TimelineState,
  TurnStartRequest,
  WorkerAttachment,
  WorkerCollaborationModeOption,
  WorkerExecutionSettings,
  WorkerModelOption,
  WorkerSettingsState,
  WorkspaceProject,
  WorkspaceState,
  WorkspaceSummary
} from "@shared";
import { appSettingsService } from "./app-settings-service";
import { codexBridge } from "./codex-bridge";
import { countDiffStats } from "./diff-stats";
import { readPersistedState } from "./persisted-state";
import {
  buildPastedImageFileName,
  estimateBase64DecodedBytes,
  getPastedImageFileExtension,
  isPastedImageByteLengthWithinLimit,
  MAX_PASTED_IMAGE_BASE64_LENGTH
} from "../pasted-image-limits";
import { buildAutoThreadName } from "./thread-auto-name";
import {
  DEFAULT_WORKER_COLLABORATION_MODES,
  buildWorkerInputs,
  getSelectedWorkerModel,
  mapWorkerCollaborationMode,
  mapWorkerModel,
  resolveWorkerSettings,
  supportsImageAttachments,
  toWorkerAttachment,
  workerSettingsFromConfig
} from "./worker-settings";
import {
  applyBridgeNotification,
  applyBridgeRequest,
  appendOptimisticUserEvent,
  buildTimelineState,
  cloneTimelineState,
  emptyTimelineState,
  markApprovalSubmitting,
  markUserInputSubmitting,
  type NotificationPayload,
  type RequestPayload,
  type TurnRecord
} from "./workspace-timeline";
import { isThreadNotMaterializedError } from "./thread-materialization";

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

type ConversationSummaryResult = {
  summary?: {
    preview?: string | null;
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

type CollaborationModeListResult = {
  data?: unknown[];
};

const EMPTY_STATE: PersistedState = {
  currentWorkspaceId: null,
  workspaces: {}
};

const isPersistedWorkspace = (value: unknown): value is PersistedWorkspace =>
  Boolean(value) &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  typeof (value as PersistedWorkspace).id === "string" &&
  typeof (value as PersistedWorkspace).name === "string" &&
  typeof (value as PersistedWorkspace).path === "string" &&
  typeof (value as PersistedWorkspace).lastOpenedAt === "string" &&
  (typeof (value as PersistedWorkspace).threadId === "string" ||
    (value as PersistedWorkspace).threadId === null);

const PERSISTED_STATE_VALIDATORS = {
  currentWorkspaceId: (value: unknown): value is string | null =>
    typeof value === "string" || value === null,
  workspaces: (value: unknown): value is Record<string, PersistedWorkspace> =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((workspace) => isPersistedWorkspace(workspace))
} as const;

const THREAD_CHANGE_SUMMARY_LIMIT = 6;
const THREAD_CHANGE_CACHE_LIMIT = 128;

const normalizeRuntimeMethod = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[.\-/\s]+/g, "_")
    .replace(/__+/g, "_")
    .toLowerCase();
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

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

const defaultThreadState = () => ({
  preview: null,
  state: "idle" as const,
  isRunning: false,
  hasPendingApproval: false,
  hasPendingUserInput: false
});

const pickNextThreadId = (threads: ThreadSummary[], archivedThreadId: string) =>
  threads.find((thread) => thread.id !== archivedThreadId)?.id ?? null;

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

  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
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
        const counts = countDiffStats(diff);
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

const clonePersistedState = (state: PersistedState): PersistedState => ({
  currentWorkspaceId: state.currentWorkspaceId,
  workspaces: Object.fromEntries(
    Object.entries(state.workspaces).map(([workspaceId, workspace]) => [
      workspaceId,
      {
        ...workspace
      }
    ])
  )
});

export class WorkspaceService extends EventEmitter {
  private liveTimelineState = emptyTimelineState();
  private readonly liveTimelineStateByThread = new Map<string, TimelineState>();
  private readonly liveTimelineSequenceByThread = new Map<string, number>();
  private activeTurnId: string | null = null;
  private readonly threadChangeCache = new Map<string, ThreadChangeSummary | null>();
  private workerModelsCache: WorkerModelOption[] | null = null;
  private workerCollaborationModesCache: WorkerCollaborationModeOption[] | null = null;
  private readonly workerSettingsByThread = new Map<string, WorkerExecutionSettings>();
  private readonly workerDraftSettingsByWorkspace = new Map<string, WorkerExecutionSettings>();
  private persistedState: PersistedState | null = null;
  private bridgeMutationQueue: Promise<void> = Promise.resolve();

  constructor() {
    super();
    codexBridge.on("notification", (payload: NotificationPayload) => {
      void this.enqueueBridgeMutation(async () => {
        await this.handleBridgeNotification(payload);
      }).catch(() => undefined);
    });
    codexBridge.on("serverRequest", (payload: RequestPayload) => {
      void this.enqueueBridgeMutation(() => {
        this.handleBridgeRequest(payload);
      }).catch(() => undefined);
    });
  }

  private get statePath() {
    return join(app.getPath("userData"), "workspace-state.json");
  }

  private get pastedAttachmentDirectoryPath() {
    return join(app.getPath("userData"), "worker-attachments", "pasted");
  }

  async getWorkspaceState(): Promise<WorkspaceState> {
    const persisted = this.readState();
    const recentWorkspaces = this.listRecentWorkspaces(persisted);
    const [projects, archivedProjects] = await Promise.all([
      this.listWorkspaceProjects(recentWorkspaces, persisted),
      this.listArchivedProjects(recentWorkspaces, persisted)
    ]);
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
      projects,
      archivedProjects
    };
  }

  async getWorkerSettingsState(): Promise<WorkerSettingsState> {
    const [models, collaborationModes] = await Promise.all([
      this.loadWorkerModels().catch(() => []),
      this.loadWorkerCollaborationModes().catch(() => DEFAULT_WORKER_COLLABORATION_MODES)
    ]);
    const settings = await this.resolveActiveWorkerSettings(models);

    return {
      settings,
      models,
      collaborationModes
    };
  }

  async updateWorkerSettings(
    patch: Partial<WorkerExecutionSettings>
  ): Promise<WorkerSettingsState> {
    const [models, collaborationModes] = await Promise.all([
      this.loadWorkerModels().catch(() => []),
      this.loadWorkerCollaborationModes().catch(() => DEFAULT_WORKER_COLLABORATION_MODES)
    ]);
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
      models,
      collaborationModes
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

  async addWorkerAttachments(paths: string[]): Promise<WorkerAttachment[]> {
    const attachments = new Map<string, WorkerAttachment>();

    for (const candidatePath of paths) {
      const normalizedPath = this.normalizeAttachmentPath(candidatePath);

      if (!normalizedPath) {
        continue;
      }

      attachments.set(normalizedPath, toWorkerAttachment(normalizedPath));
    }

    return [...attachments.values()];
  }

  async addPastedImageAttachments(
    images: PastedImageAttachment[]
  ): Promise<WorkerAttachment[]> {
    if (images.length === 0) {
      return [];
    }

    const attachments: WorkerAttachment[] = [];
    mkdirSync(this.pastedAttachmentDirectoryPath, { recursive: true });

    for (const image of images) {
      const normalizedImage = this.normalizePastedImageAttachment(image);

      if (!normalizedImage) {
        continue;
      }

      const filePath = join(
        this.pastedAttachmentDirectoryPath,
        `${randomUUID()}-${normalizedImage.fileName}`
      );
      writeFileSync(filePath, normalizedImage.data);
      attachments.push(toWorkerAttachment(filePath));
    }

    return attachments;
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

  async clearRecentWorkspaces(): Promise<WorkspaceState> {
    const persisted = this.readState();

    if (!persisted.currentWorkspaceId) {
      this.writeState({
        currentWorkspaceId: null,
        workspaces: {}
      });
      return this.getWorkspaceState();
    }

    const currentWorkspace = persisted.workspaces[persisted.currentWorkspaceId] ?? null;

    this.writeState({
      currentWorkspaceId: currentWorkspace?.id ?? null,
      workspaces: currentWorkspace ? { [currentWorkspace.id]: currentWorkspace } : {}
    });

    return this.getWorkspaceState();
  }

  async removeWorkspace(workspaceId: string): Promise<WorkspaceState> {
    const persisted = this.readState();
    const workspace = persisted.workspaces[workspaceId];

    if (!workspace) {
      throw new Error("Workspace not found.");
    }

    if (persisted.currentWorkspaceId === workspaceId && this.activeTurnId) {
      throw new Error("Stop active work before removing this project.");
    }

    delete persisted.workspaces[workspaceId];
    this.workerDraftSettingsByWorkspace.delete(workspaceId);

    if (workspace.threadId) {
      this.workerSettingsByThread.delete(workspace.threadId);
      this.clearTimelineCache(workspace.threadId);
    }

    if (persisted.currentWorkspaceId === workspaceId) {
      const nextWorkspace = this.listRecentWorkspaces(persisted)[0] ?? null;
      persisted.currentWorkspaceId = nextWorkspace?.id ?? null;
      this.activeTurnId = null;
      if (nextWorkspace?.threadId) {
        await this.hydrateLiveTimeline(nextWorkspace.threadId, emptyTimelineState(nextWorkspace.threadId));
      } else {
        this.setLiveTimelineState(emptyTimelineState());
      }
    }

    this.writeState(persisted);
    return this.getWorkspaceState();
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
    this.clearTimelineCache(started.thread.id);
    this.setLiveTimelineState({
      ...emptyTimelineState(started.thread.id),
      runState: {
        phase: "idle",
        label: "Idle"
      }
    });

    return cloneTimelineState(this.liveTimelineState);
  }

  async archiveThread(workspaceId: string, threadId: string): Promise<ArchiveThreadResult> {
    const persisted = this.readState();
    const workspace = persisted.workspaces[workspaceId];

    if (!workspace) {
      throw new Error("Workspace not found.");
    }

    if (
      persisted.currentWorkspaceId === workspaceId &&
      workspace.threadId === threadId &&
      this.activeTurnId
    ) {
      throw new Error("Stop active work before archiving this thread.");
    }

    const wasSelectedThread = workspace.threadId === threadId;

    await codexBridge.archiveThread(threadId);
    this.clearTimelineCache(threadId);

    if (wasSelectedThread) {
      workspace.threadId = await this.findNextThreadId(workspace.path, threadId);
      persisted.workspaces[workspace.id] = workspace;

      if (persisted.currentWorkspaceId === workspaceId) {
        this.activeTurnId = null;
        if (workspace.threadId) {
          await this.hydrateLiveTimeline(workspace.threadId, emptyTimelineState(workspace.threadId));
        } else {
          this.setLiveTimelineState(emptyTimelineState());
        }
      }
    }

    workspace.lastOpenedAt = now();
    persisted.workspaces[workspace.id] = workspace;
    this.writeState(persisted);

    return {
      timelineState:
        persisted.currentWorkspaceId === workspaceId
          ? cloneTimelineState(this.liveTimelineState)
          : await this.getTimelineState(),
      workspaceId,
      archivedThreadId: threadId,
      selectedThreadId: workspace.threadId ?? null
    };
  }

  async unarchiveThread(workspaceId: string, threadId: string): Promise<TimelineState> {
    const persisted = this.readState();
    const workspace = persisted.workspaces[workspaceId];

    if (!workspace) {
      throw new Error("Workspace not found.");
    }

    await codexBridge.unarchiveThread(threadId);
    this.clearTimelineCache(threadId);

    persisted.currentWorkspaceId = workspaceId;
    workspace.threadId = threadId;
    workspace.lastOpenedAt = now();
    persisted.workspaces[workspace.id] = workspace;
    this.writeState(persisted);

    this.activeTurnId = null;
    await this.hydrateLiveTimeline(threadId, emptyTimelineState(threadId));
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

    await this.hydrateLiveTimeline(threadId);
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

    const cachedTimeline = this.getCachedTimelineState(workspace.threadId);

    if (cachedTimeline) {
      this.setLiveTimelineState(cachedTimeline);
      return cloneTimelineState(cachedTimeline);
    }

    const timeline = await withTimeout(
      this.readThreadTimeline(workspace.threadId),
      1500,
      null
    ).catch(() => null);

    if (!timeline) {
      return {
        ...emptyTimelineState(workspace.threadId),
        runState: {
          phase: "historyUnavailable",
          label: "History unavailable"
        }
      };
    }

    this.setLiveTimelineState(timeline);
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
    const previousTimeline = cloneTimelineState(this.liveTimelineState);
    const isFreshThread =
      !hadThread || (previousTimeline.threadId === threadId && previousTimeline.entries.length === 0);
    workspace.threadId = threadId;
    workspace.lastOpenedAt = now();
    persisted.workspaces[workspace.id] = workspace;
    this.writeState(persisted);
    this.setLiveTimelineState(
      appendOptimisticUserEvent(
        hadThread
          ? await this.hydrateLiveTimeline(threadId)
          : {
              ...emptyTimelineState(threadId),
              runState: {
                phase: "starting",
                label: "Starting"
              }
            },
        trimmedPrompt
      )
    );

    try {
      const resolvedModel = selectedModel?.model ?? settings.model ?? null;
      const started = (await codexBridge.startTurn(
        threadId,
        input,
        settings,
        resolvedModel
      )) as {
        turn?: { id?: string };
      };
      if (isFreshThread) {
        this.workerSettingsByThread.set(threadId, settings);
        this.workerDraftSettingsByWorkspace.delete(workspace.id);
        if (appSettingsService.getSettings().autoNameNewThreads) {
          await this.autoNameThread(threadId, trimmedPrompt);
        }
      }
      this.activeTurnId = started.turn?.id ?? this.activeTurnId;
      this.setLiveTimelineState({
        ...this.ensureLiveTimeline(threadId),
        isRunning: true,
        runState: {
          phase: started.turn?.id ? "running" : "starting",
          label: started.turn?.id ? "Working" : "Starting"
        }
      });

      return cloneTimelineState(this.liveTimelineState);
    } catch (error) {
      this.setLiveTimelineState(previousTimeline);
      throw error;
    }
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

    this.setLiveTimelineState({
      ...this.ensureLiveTimeline(threadId),
      isRunning: true,
      runState: {
        phase: "steering",
        label: "Steering"
      }
    });

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
    await this.hydrateLiveTimeline(threadId, {
      ...this.ensureLiveTimeline(threadId),
      isRunning: false,
      runState: {
        phase: "interrupted",
        label: "Interrupted"
      }
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

    this.setLiveTimelineState(markApprovalSubmitting(this.liveTimelineState, requestId, true));

    try {
      await codexBridge.respond(requestId, { decision });
      return cloneTimelineState(this.liveTimelineState);
    } catch (error) {
      this.setLiveTimelineState(markApprovalSubmitting(this.liveTimelineState, requestId, false));
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

    this.setLiveTimelineState(markUserInputSubmitting(this.liveTimelineState, requestId, true));

    try {
      await codexBridge.respond(requestId, { answers: normalizedAnswers });
      return cloneTimelineState(this.liveTimelineState);
    } catch (error) {
      this.setLiveTimelineState(markUserInputSubmitting(this.liveTimelineState, requestId, false));
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
    let result: ThreadReadResult;

    try {
      result = (await codexBridge.readThread(threadId)) as ThreadReadResult;
    } catch (error) {
      if (isThreadNotMaterializedError(error)) {
        this.activeTurnId = null;
        return {
          ...emptyTimelineState(threadId),
          runState: {
            phase: "idle",
            label: "Idle"
          }
        };
      }

      throw error;
    }

    const turns = result.thread?.turns ?? [];
    this.activeTurnId = turns.find((turn) => turn.status === "inProgress")?.id ?? null;
    return buildTimelineState(threadId, turns);
  }

  private async listThreads(
    workspacePath: string,
    archived = false,
    includeChangeSummary = true
  ): Promise<ThreadSummary[]> {
    try {
      await codexBridge.start();
      const result = (await codexBridge.listThreads(workspacePath, archived)) as ThreadListResult;

      const threads: ThreadSummary[] = (result.data ?? []).map((thread) => ({
        ...defaultThreadState(),
        id: thread.id ?? randomUUID(),
        title: thread.name ?? thread.preview ?? "Untitled thread",
        updatedAt: formatUpdatedAt(thread.updatedAt),
        preview: typeof thread.preview === "string" ? thread.preview.trim() || null : null,
        changeSummary: null
      }));

      if (includeChangeSummary) {
        await Promise.all(
          threads.slice(0, THREAD_CHANGE_SUMMARY_LIMIT).map(async (thread) => {
            thread.changeSummary = await this.getThreadChangeSummary(thread.id);
          })
        );
      }

      return threads;
    } catch {
      return [];
    }
  }

  private async listThreadsSnapshot(
    workspacePath: string,
    archived = false,
    includeChangeSummary = true
  ): Promise<ThreadSummary[]> {
    return withTimeout(this.listThreads(workspacePath, archived, includeChangeSummary), 1500, []);
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
            ...defaultThreadState(),
            id: workspace.threadId,
            title: "New thread",
            updatedAt: "now",
            preview: null,
            changeSummary: null
          });
        }

        if (
          workspace.id === state.currentWorkspaceId &&
          this.liveTimelineState.threadId &&
          workspace.threadId
        ) {
          const activeThread = threads.find((thread) => thread.id === workspace.threadId);

          if (activeThread && this.liveTimelineState.threadId === workspace.threadId) {
            activeThread.isRunning = this.liveTimelineState.isRunning;
            activeThread.hasPendingApproval = this.liveTimelineState.approvals.length > 0;
            activeThread.hasPendingUserInput = this.liveTimelineState.userInputs.length > 0;
            activeThread.state = activeThread.hasPendingApproval
              ? "approval"
              : activeThread.hasPendingUserInput
                ? "input"
                : activeThread.isRunning
                  ? "running"
                  : "idle";
          }
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

  private async listArchivedProjects(
    workspaces: PersistedWorkspace[],
    state: PersistedState
  ): Promise<WorkspaceProject[]> {
    const projects = await Promise.all(
      workspaces.map(async (workspace) => ({
        ...toWorkspaceSummary(workspace),
        isCurrent: workspace.id === state.currentWorkspaceId,
        currentThreadId: workspace.threadId,
        threads: await this.listThreadsSnapshot(workspace.path, true)
      }))
    );

    return projects.filter((project) => project.threads.length > 0);
  }

  private async findNextThreadId(workspacePath: string, archivedThreadId: string) {
    const threads = await this.listThreadsSnapshot(workspacePath, false, false);
    return pickNextThreadId(threads, archivedThreadId);
  }

  private async getThreadChangeSummary(threadId: string): Promise<ThreadChangeSummary | null> {
    if (this.threadChangeCache.has(threadId)) {
      const summary = this.threadChangeCache.get(threadId) ?? null;
      this.cacheThreadChangeSummary(threadId, summary);
      return summary;
    }

    const summary = await withTimeout(this.readThreadChangeSummary(threadId), 900, null).catch(
      () => null
    );
    this.cacheThreadChangeSummary(threadId, summary);
    return summary;
  }

  private async readThreadChangeSummary(threadId: string): Promise<ThreadChangeSummary | null> {
    await codexBridge.start();
    let result: ThreadReadResult;

    try {
      result = (await codexBridge.readThread(threadId)) as ThreadReadResult;
    } catch (error) {
      if (isThreadNotMaterializedError(error)) {
        return null;
      }

      throw error;
    }

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

  private async loadWorkerCollaborationModes(): Promise<WorkerCollaborationModeOption[]> {
    if (this.workerCollaborationModesCache) {
      return this.workerCollaborationModesCache;
    }

    try {
      await codexBridge.start();
      const result = (await codexBridge.listCollaborationModes()) as CollaborationModeListResult;
      const collaborationModes = (result.data ?? [])
        .map((entry) =>
          entry && typeof entry === "object"
            ? mapWorkerCollaborationMode(entry as Record<string, unknown>)
            : null
        )
        .filter((entry): entry is WorkerCollaborationModeOption => Boolean(entry));

      this.workerCollaborationModesCache =
        collaborationModes.length > 0 ? collaborationModes : DEFAULT_WORKER_COLLABORATION_MODES;
    } catch {
      this.workerCollaborationModesCache = DEFAULT_WORKER_COLLABORATION_MODES;
    }

    return this.workerCollaborationModesCache;
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

  private async autoNameThread(threadId: string, prompt: string) {
    const fallbackName = buildAutoThreadName(null, prompt);

    try {
      const result = (await codexBridge.getConversationSummary(threadId)) as ConversationSummaryResult;
      const nextName = buildAutoThreadName(result.summary?.preview ?? null, prompt);

      if (!nextName) {
        return;
      }

      await codexBridge.setThreadName(threadId, nextName);
      return;
    } catch {
      if (!fallbackName) {
        return;
      }
    }

    if (!fallbackName) {
      return;
    }

    try {
      await codexBridge.setThreadName(threadId, fallbackName);
    } catch {
      // Keep the starter title if the bridge refuses the rename.
    }
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
    if (this.persistedState) {
      return this.persistedState;
    }

    try {
      const raw = readFileSync(this.statePath, "utf8");
      const parsed = readPersistedState(raw, EMPTY_STATE, PERSISTED_STATE_VALIDATORS);
      this.persistedState = clonePersistedState(parsed);
    } catch {
      this.persistedState = clonePersistedState({
        currentWorkspaceId: EMPTY_STATE.currentWorkspaceId,
        workspaces: {}
      });
    }

    return this.persistedState;
  }

  private writeState(state: PersistedState) {
    const nextState = clonePersistedState(state);
    this.persistedState = nextState;
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(this.statePath, JSON.stringify(nextState, null, 2));
  }

  private cacheThreadChangeSummary(threadId: string, summary: ThreadChangeSummary | null) {
    if (this.threadChangeCache.has(threadId)) {
      this.threadChangeCache.delete(threadId);
    }

    this.threadChangeCache.set(threadId, summary);

    if (this.threadChangeCache.size <= THREAD_CHANGE_CACHE_LIMIT) {
      return;
    }

    const oldestThreadId = this.threadChangeCache.keys().next().value;

    if (typeof oldestThreadId === "string") {
      this.threadChangeCache.delete(oldestThreadId);
    }
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

  private normalizeAttachmentPath(inputPath: string) {
    const trimmedPath = inputPath.trim();

    if (!trimmedPath) {
      return null;
    }

    try {
      const resolvedPath = realpathSync(trimmedPath);
      return statSync(resolvedPath).isFile() ? resolvedPath : null;
    } catch {
      return null;
    }
  }

  private normalizePastedImageAttachment(image: PastedImageAttachment) {
    if (
      !image ||
      typeof image.name !== "string" ||
      typeof image.mimeType !== "string" ||
      typeof image.dataBase64 !== "string"
    ) {
      return null;
    }

    const mimeType = image.mimeType.trim().toLowerCase();

    if (!getPastedImageFileExtension(mimeType)) {
      return null;
    }

    const dataBase64 = image.dataBase64.trim();

    if (!dataBase64) {
      return null;
    }

    if (dataBase64.length > MAX_PASTED_IMAGE_BASE64_LENGTH || dataBase64.length % 4 !== 0) {
      return null;
    }

    const isBase64 = BASE64_PATTERN.test(dataBase64);

    if (!isBase64) {
      return null;
    }

    if (!isPastedImageByteLengthWithinLimit(estimateBase64DecodedBytes(dataBase64))) {
      return null;
    }

    const data = Buffer.from(dataBase64, "base64");

    if (!isPastedImageByteLengthWithinLimit(data.byteLength)) {
      return null;
    }

    return {
      data,
      fileName: buildPastedImageFileName(image.name, mimeType)
    };
  }

  private async handleBridgeNotification(payload: NotificationPayload) {
    this.syncActiveTurnFromNotification(payload);
    this.invalidateThreadCache(payload);
    const threadId = this.getTimelinePayloadThreadId(payload.params);

    if (threadId) {
      const nextSequence = this.getTimelinePayloadSequence(payload.params);
      const previousSequence = this.liveTimelineSequenceByThread.get(threadId);

      if (
        nextSequence !== null &&
        previousSequence !== undefined &&
        nextSequence > previousSequence + 1
      ) {
        await this.hydrateLiveTimeline(threadId, this.getCachedTimelineState(threadId) ?? emptyTimelineState(threadId));
        this.liveTimelineSequenceByThread.set(threadId, nextSequence);
        return;
      }

      if (nextSequence !== null && previousSequence !== undefined && nextSequence <= previousSequence) {
        return;
      }

      const baseState =
        this.getCachedTimelineState(threadId) ??
        (this.liveTimelineState.threadId === threadId ? this.liveTimelineState : emptyTimelineState(threadId));
      const nextState = await applyBridgeNotification(
        baseState,
        payload,
        (candidateThreadId) => candidateThreadId === threadId,
        (candidateThreadId, currentState) => this.hydrateLiveTimeline(candidateThreadId, currentState)
      );

      if (nextSequence !== null) {
        this.liveTimelineSequenceByThread.set(threadId, nextSequence);
      }

      this.cacheTimelineState(nextState);

      if (this.isCurrentThread(threadId)) {
        this.setLiveTimelineState(nextState);
      }

      return;
    }

    this.setLiveTimelineState(
      await applyBridgeNotification(
        this.liveTimelineState,
        payload,
        (candidateThreadId) => this.isCurrentThread(candidateThreadId),
        (candidateThreadId, currentState) => this.hydrateLiveTimeline(candidateThreadId, currentState)
      )
    );
  }

  private handleBridgeRequest(payload: RequestPayload) {
    const threadId = this.getTimelinePayloadThreadId(payload.params);
    const cachedState = threadId ? this.getCachedTimelineState(threadId) : null;
    const baseState = cachedState ?? this.liveTimelineState;
    const nextState = applyBridgeRequest(baseState, payload, (candidateThreadId) =>
      threadId ? candidateThreadId === threadId : this.isCurrentThread(candidateThreadId)
    );

    this.cacheTimelineState(nextState);

    if (!threadId || this.isCurrentThread(threadId)) {
      this.setLiveTimelineState(nextState);
    }
  }

  private enqueueBridgeMutation(action: () => void | Promise<void>) {
    this.bridgeMutationQueue = this.bridgeMutationQueue
      .catch(() => undefined)
      .then(async () => {
        await action();
      });
    return this.bridgeMutationQueue;
  }

  private async hydrateLiveTimeline(
    threadId: string,
    currentState: TimelineState = this.liveTimelineState
  ): Promise<TimelineState> {
    const snapshot = await this.readThreadTimeline(threadId);
    const existing =
      currentState.threadId === threadId
        ? currentState
        : this.getCachedTimelineState(threadId);
    const mergedState: TimelineState = {
      ...snapshot,
      approvals: existing?.approvals ?? [],
      userInputs: existing?.userInputs ?? [],
      activePlan: existing?.activePlan ?? snapshot.activePlan,
      latestProposedPlan: existing?.latestProposedPlan ?? snapshot.latestProposedPlan,
      turnDiffs: existing?.turnDiffs?.length ? existing.turnDiffs : snapshot.turnDiffs,
      activeDiffPreview: existing?.activeDiffPreview ?? snapshot.activeDiffPreview,
      activeWorkStartedAt: existing?.activeWorkStartedAt ?? snapshot.activeWorkStartedAt,
      latestTurn: existing?.latestTurn ?? snapshot.latestTurn,
      isRunning: snapshot.isRunning || existing?.isRunning === true,
      runState:
        snapshot.isRunning || existing?.isRunning === true
          ? existing?.runState ?? snapshot.runState
          : snapshot.runState
    };

    this.cacheTimelineState(mergedState);

    if (this.isCurrentThread(threadId)) {
      this.setLiveTimelineState(mergedState);
    }

    return cloneTimelineState(mergedState);
  }

  private setLiveTimelineState(nextState: TimelineState) {
    this.liveTimelineState = cloneTimelineState(nextState);
    this.cacheTimelineState(this.liveTimelineState);
    this.emit("timeline", cloneTimelineState(this.liveTimelineState));
  }

  private cacheTimelineState(nextState: TimelineState) {
    if (!nextState.threadId) {
      return;
    }

    this.liveTimelineStateByThread.set(nextState.threadId, cloneTimelineState(nextState));
  }

  private getCachedTimelineState(threadId: string) {
    const cached = this.liveTimelineStateByThread.get(threadId);
    return cached ? cloneTimelineState(cached) : null;
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

    const methodKey = normalizeRuntimeMethod(payload.method);

    if (methodKey === "turn_started") {
      this.activeTurnId =
        params?.turn && typeof params.turn.id === "string" ? params.turn.id : this.activeTurnId;
      return;
    }

    if (methodKey === "turn_completed" || methodKey === "turn_aborted") {
      this.activeTurnId = null;
    }
  }

  private getTimelinePayloadThreadId(params: unknown) {
    return params && typeof params === "object" && typeof (params as { threadId?: unknown }).threadId === "string"
      ? ((params as { threadId: string }).threadId)
      : null;
  }

  private getTimelinePayloadSequence(params: unknown) {
    if (!params || typeof params !== "object") {
      return null;
    }

    const sequence = (params as { sequence?: unknown; eventSequence?: unknown }).sequence;
    const eventSequence = (params as { sequence?: unknown; eventSequence?: unknown }).eventSequence;

    if (typeof sequence === "number" && Number.isFinite(sequence)) {
      return sequence;
    }

    if (typeof eventSequence === "number" && Number.isFinite(eventSequence)) {
      return eventSequence;
    }

    return null;
  }

  private invalidateThreadCache(payload: NotificationPayload) {
    const params = payload.params as { threadId?: unknown } | undefined;
    const threadId = typeof params?.threadId === "string" ? params.threadId : null;
    const methodKey = normalizeRuntimeMethod(payload.method);

    if (!threadId) {
      return;
    }

    if (
      methodKey === "turn_started" ||
      methodKey === "turn_completed" ||
      methodKey === "turn_aborted" ||
      methodKey === "turn_diff_updated" ||
      methodKey === "thread_archived" ||
      methodKey === "thread_unarchived" ||
      methodKey === "item_started" ||
      methodKey === "item_updated" ||
      methodKey === "item_completed"
    ) {
      this.threadChangeCache.delete(threadId);
    }
  }

  private clearTimelineCache(threadId: string) {
    this.threadChangeCache.delete(threadId);
    this.liveTimelineStateByThread.delete(threadId);
    this.liveTimelineSequenceByThread.delete(threadId);
  }
}

export const workspaceService = new WorkspaceService();
