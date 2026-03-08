import { app, dialog } from "electron";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { realpathSync } from "node:fs";
import type { ThreadSummary, WorkspaceState, WorkspaceSummary } from "@shared";
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
