import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceIntent } from "@shared";

type WorkRequestIntent = Extract<VoiceIntent, { kind: "work_request" }>;
type WorkRequestIntentOverrides = Partial<Omit<WorkRequestIntent, "source" | "taskEnvelope">> & {
  source?: Partial<WorkRequestIntent["source"]>;
  taskEnvelope?: Partial<WorkRequestIntent["taskEnvelope"]>;
};

describe("WorkspaceService", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("caches persisted workspace state after the first disk read", async () => {
    const readFileSync = vi.fn(() =>
      JSON.stringify({
        currentWorkspaceId: "workspace-1",
        workspaces: {
          "workspace-1": {
            id: "workspace-1",
            name: "CodexRealtime",
            path: "/tmp/CodexRealtime",
            lastOpenedAt: "2026-03-11T00:00:00.000Z",
            threadId: "thread-1"
          }
        }
      })
    );
    const mkdirSync = vi.fn();
    const writeFileSync = vi.fn();
    const on = vi.fn();

    vi.doMock("node:fs", () => ({
      mkdirSync,
      readFileSync,
      statSync: vi.fn(() => ({ size: 1_024 })),
      writeFileSync,
      realpathSync: vi.fn((value: string) => value)
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp/codex",
        focus: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
        setLoginItemSettings: vi.fn()
      },
      BrowserWindow: {
        getFocusedWindow: vi.fn(() => null),
        getAllWindows: vi.fn(() => [])
      },
      dialog: {
        showOpenDialog: vi.fn()
      },
      Notification: {
        isSupported: () => true
      }
    }));
    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on
      }
    }));

    const { WorkspaceService } = await import("./workspace-service");
    const service = new WorkspaceService();
    const readState = (service as unknown as { readState: () => { currentWorkspaceId: string | null } })
      .readState.bind(service);

    expect(readState().currentWorkspaceId).toBe("workspace-1");
    expect(readState().currentWorkspaceId).toBe("workspace-1");
    expect(readFileSync).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledTimes(4);
  });

  it("skips oversized persisted workspace state files before reading them", async () => {
    const readFileSync = vi.fn();

    vi.doMock("node:fs", () => ({
      mkdirSync: vi.fn(),
      readFileSync,
      statSync: vi.fn(() => ({ size: 70 * 1024 })),
      writeFileSync: vi.fn(),
      realpathSync: vi.fn((value: string) => value)
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp/codex",
        focus: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
        setLoginItemSettings: vi.fn()
      },
      BrowserWindow: {
        getFocusedWindow: vi.fn(() => null),
        getAllWindows: vi.fn(() => [])
      },
      dialog: {
        showOpenDialog: vi.fn()
      },
      Notification: {
        isSupported: () => true
      }
    }));
    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn()
      }
    }));

    const { WorkspaceService } = await import("./workspace-service");
    const service = new WorkspaceService();
    const readState = (
      service as unknown as {
        readState: () => { currentWorkspaceId: string | null; workspaces: Record<string, unknown> };
      }
    ).readState.bind(service);

    expect(readState()).toEqual({
      currentWorkspaceId: null,
      workspaces: {}
    });
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it("bounds the thread change cache", async () => {
    vi.doMock("node:fs", () => ({
      mkdirSync: vi.fn(),
      readFileSync: vi.fn(() => JSON.stringify({ currentWorkspaceId: null, workspaces: {} })),
      statSync: vi.fn(() => ({ size: 1_024 })),
      writeFileSync: vi.fn(),
      realpathSync: vi.fn((value: string) => value)
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp/codex",
        focus: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
        setLoginItemSettings: vi.fn()
      },
      BrowserWindow: {
        getFocusedWindow: vi.fn(() => null),
        getAllWindows: vi.fn(() => [])
      },
      dialog: {
        showOpenDialog: vi.fn()
      },
      Notification: {
        isSupported: () => true
      }
    }));
    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn()
      }
    }));

    const { WorkspaceService } = await import("./workspace-service");
    const service = new WorkspaceService();
    const cacheThreadChangeSummary = (
      service as unknown as {
        cacheThreadChangeSummary: (
          threadId: string,
          summary: { additions: number; deletions: number } | null
        ) => void;
      }
    ).cacheThreadChangeSummary.bind(service);
    const threadChangeCache = (
      service as unknown as {
        threadChangeCache: Map<string, { additions: number; deletions: number } | null>;
      }
    ).threadChangeCache;

    for (let index = 0; index < 140; index += 1) {
      cacheThreadChangeSummary(`thread-${index}`, {
        additions: index,
        deletions: index
      });
    }

    expect(threadChangeCache.size).toBe(128);
    expect(threadChangeCache.has("thread-11")).toBe(false);
    expect(threadChangeCache.has("thread-12")).toBe(true);
    expect(threadChangeCache.has("thread-139")).toBe(true);
  });

  it("persists active-thread worker settings in workspace state and restores them after restart", async () => {
    let persistedState = JSON.stringify({
      currentWorkspaceId: "workspace-1",
      workspaces: {
        "workspace-1": {
          id: "workspace-1",
          name: "CodexRealtime",
          path: "/tmp/CodexRealtime",
          lastOpenedAt: "2026-03-11T00:00:00.000Z",
          threadId: "thread-existing",
          threadSettings: {
            "thread-existing": {
              model: "gpt-5.3-codex",
              reasoningEffort: "medium",
              fastMode: true,
              approvalPolicy: "on-request",
              collaborationMode: "default"
            }
          }
        }
      }
    });
    const writeFileSync = vi.fn((_: string, payload: string) => {
      persistedState = payload;
    });

    vi.doMock("node:fs", () => ({
      mkdirSync: vi.fn(),
      readFileSync: vi.fn(() => persistedState),
      statSync: vi.fn(() => ({ size: 1_024 })),
      writeFileSync,
      realpathSync: vi.fn((value: string) => value)
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp/codex",
        focus: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
        setLoginItemSettings: vi.fn()
      },
      BrowserWindow: {
        getFocusedWindow: vi.fn(() => null),
        getAllWindows: vi.fn(() => [])
      },
      dialog: {
        showOpenDialog: vi.fn()
      },
      Notification: {
        isSupported: () => true
      }
    }));
    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn(),
        readConfig: vi.fn(async () => ({
          config: {
            model: "gpt-5.4",
            model_reasoning_effort: "xhigh",
            approval_policy: "never",
            service_tier: "fast"
          }
        }))
      }
    }));

    const { WorkspaceService } = await import("./workspace-service");
    const service = new WorkspaceService();

    const initialState = await service.getWorkerSettingsState();
    expect(initialState.settings.model).toBe("gpt-5.3-codex");
    expect(initialState.settings.reasoningEffort).toBe("medium");
    expect(initialState.settings.fastMode).toBe(true);
    expect(initialState.settings.approvalPolicy).toBe("on-request");
    expect(initialState.settings.collaborationMode).toBe("default");

    await service.updateWorkerSettings({ model: "gpt-5.4", reasoningEffort: "xhigh" });

    const currentState = JSON.parse(persistedState) as {
      workspaces: Record<string, { threadSettings?: Record<string, unknown> }>;
    };
    expect(currentState.workspaces["workspace-1"].threadSettings?.["thread-existing"]).toEqual({
      model: "gpt-5.4",
      reasoningEffort: "xhigh",
      fastMode: true,
      approvalPolicy: "on-request",
      collaborationMode: "default"
    });

    const restartedService = new WorkspaceService();
    const restartedSettings = await restartedService.getWorkerSettingsState();
    expect(restartedSettings.settings.model).toBe("gpt-5.4");
    expect(restartedSettings.settings.reasoningEffort).toBe("xhigh");
  });

  it("uses workspace config defaults when creating a new thread", async () => {
    let persistedState = JSON.stringify({
      currentWorkspaceId: "workspace-1",
      workspaces: {
        "workspace-1": {
          id: "workspace-1",
          name: "CodexRealtime",
          path: "/tmp/CodexRealtime",
          lastOpenedAt: "2026-03-11T00:00:00.000Z",
          threadId: "thread-existing",
          threadSettings: {
            "thread-existing": {
              model: "gpt-5.3-codex",
              reasoningEffort: "medium",
              fastMode: true,
              approvalPolicy: "on-request",
              collaborationMode: "default"
            }
          }
        }
      }
    });
    const writeFileSync = vi.fn((_: string, payload: string) => {
      persistedState = payload;
    });
    const startThread = vi.fn(async () => ({
      thread: {
        id: "thread-created"
      }
    }));

    vi.doMock("node:fs", () => ({
      mkdirSync: vi.fn(),
      readFileSync: vi.fn(() => persistedState),
      statSync: vi.fn(() => ({ size: 1_024 })),
      writeFileSync,
      realpathSync: vi.fn((value: string) => value)
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp/codex",
        focus: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
        setLoginItemSettings: vi.fn()
      },
      BrowserWindow: {
        getFocusedWindow: vi.fn(() => null),
        getAllWindows: vi.fn(() => [])
      },
      dialog: {
        showOpenDialog: vi.fn()
      },
      Notification: {
        isSupported: () => true
      }
    }));
    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn(),
        startThread,
        readConfig: vi.fn(async () => ({
          config: {
            model: "gpt-5.4",
            model_reasoning_effort: "xhigh",
            approval_policy: "never",
            service_tier: "fast"
          }
        }))
      }
    }));

    const { WorkspaceService } = await import("./workspace-service");
    const service = new WorkspaceService();

    const beforeCreate = await service.getWorkerSettingsState();
    expect(beforeCreate.settings.model).toBe("gpt-5.3-codex");

    await service.createThread("workspace-1");

    const afterCreate = await service.getWorkerSettingsState();
    expect(afterCreate.settings).toMatchObject({
      model: "gpt-5.4",
      reasoningEffort: "xhigh",
      fastMode: true,
      approvalPolicy: "never",
      collaborationMode: "default"
    });
    expect(afterCreate.settings.model).not.toBe("gpt-5.3-codex");
    expect(startThread).toHaveBeenCalledWith("/tmp/CodexRealtime");
  });

  it("drops a fresh unmaterialized thread when archiving it immediately", async () => {
    const writeFileSync = vi.fn();
    const archiveThread = vi.fn(async () => {
      throw new Error(
        "thread draft-thread is not materialized yet; includeTurns is unavailable before first user message"
      );
    });
    const listThreads = vi.fn(async (_cwd: string, archived = false) => ({
      data: archived
        ? []
        : [
            {
              id: "thread-existing",
              name: "Existing thread",
              preview: "Existing thread",
              updatedAt: Math.floor(Date.now() / 1000)
            }
          ]
    }));
    const readThread = vi.fn(async (threadId: string) => ({
      thread: {
        id: threadId,
        turns: []
      }
    }));

    vi.doMock("node:fs", () => ({
      mkdirSync: vi.fn(),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          currentWorkspaceId: "workspace-1",
          workspaces: {
            "workspace-1": {
              id: "workspace-1",
              name: "CodexRealtime",
              path: "/tmp/CodexRealtime",
              lastOpenedAt: "2026-03-11T00:00:00.000Z",
              threadId: "draft-thread"
            }
          }
        })
      ),
      statSync: vi.fn(() => ({ size: 1_024 })),
      writeFileSync,
      realpathSync: vi.fn((value: string) => value)
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp/codex",
        focus: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
        setLoginItemSettings: vi.fn()
      },
      BrowserWindow: {
        getFocusedWindow: vi.fn(() => null),
        getAllWindows: vi.fn(() => [])
      },
      dialog: {
        showOpenDialog: vi.fn()
      },
      Notification: {
        isSupported: () => true
      }
    }));
    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn(),
        start: vi.fn(),
        archiveThread,
        listThreads,
        readThread
      }
    }));

    const { WorkspaceService } = await import("./workspace-service");
    const service = new WorkspaceService();

    const result = await service.archiveThread("workspace-1", "draft-thread");

    expect(archiveThread).toHaveBeenCalledWith("draft-thread");
    expect(listThreads).toHaveBeenCalledWith("/tmp/CodexRealtime", false);
    expect(readThread).toHaveBeenCalledWith("thread-existing");
    expect(result.selectedThreadId).toBe("thread-existing");
    expect(result.timelineState.threadId).toBe("thread-existing");
    expect(writeFileSync).toHaveBeenCalled();
  });

  it("drops a fresh unpersisted thread when archive reports not found", async () => {
    const writeFileSync = vi.fn();
    const archiveThread = vi.fn(async () => {
      throw new Error("no outline found for thread id draft-thread");
    });
    const listThreads = vi.fn(async (_cwd: string, archived = false) => ({
      data: archived
        ? []
        : [
            {
              id: "thread-existing",
              name: "Existing thread",
              preview: "Existing thread",
              updatedAt: Math.floor(Date.now() / 1000)
            }
          ]
    }));
    const readThread = vi.fn(async (threadId: string) => ({
      thread: {
        id: threadId,
        turns: []
      }
    }));

    vi.doMock("node:fs", () => ({
      mkdirSync: vi.fn(),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          currentWorkspaceId: "workspace-1",
          workspaces: {
            "workspace-1": {
              id: "workspace-1",
              name: "CodexRealtime",
              path: "/tmp/CodexRealtime",
              lastOpenedAt: "2026-03-11T00:00:00.000Z",
              threadId: "draft-thread"
            }
          }
        })
      ),
      statSync: vi.fn(() => ({ size: 1_024 })),
      writeFileSync,
      realpathSync: vi.fn((value: string) => value)
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp/codex",
        focus: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
        setLoginItemSettings: vi.fn()
      },
      BrowserWindow: {
        getFocusedWindow: vi.fn(() => null),
        getAllWindows: vi.fn(() => [])
      },
      dialog: {
        showOpenDialog: vi.fn()
      },
      Notification: {
        isSupported: () => true
      }
    }));
    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn(),
        start: vi.fn(),
        archiveThread,
        listThreads,
        readThread
      }
    }));

    const { WorkspaceService } = await import("./workspace-service");
    const service = new WorkspaceService();

    const result = await service.archiveThread("workspace-1", "draft-thread");

    expect(archiveThread).toHaveBeenCalledWith("draft-thread");
    expect(listThreads).toHaveBeenCalledWith("/tmp/CodexRealtime", false);
    expect(readThread).toHaveBeenCalledWith("thread-existing");
    expect(result.selectedThreadId).toBe("thread-existing");
    expect(result.timelineState.threadId).toBe("thread-existing");
    expect(writeFileSync).toHaveBeenCalled();
  });

  it("normalizes alternate thread identifier fields from thread/list", async () => {
    const readFileSync = vi.fn(() =>
      JSON.stringify({
        currentWorkspaceId: "workspace-1",
        workspaces: {
          "workspace-1": {
            id: "workspace-1",
            name: "CodexRealtime",
            path: "/tmp/CodexRealtime",
            lastOpenedAt: "2026-03-11T00:00:00.000Z",
            threadId: null
          }
        }
      })
    );
    const listThreads = vi.fn(
      async (_cwd: string, archived = false) =>
        archived
          ? { data: [] }
          : {
              data: [
                {
                  threadId: "thread-legacy-id",
                  name: "Legacy thread",
                  preview: "Legacy thread",
                  updatedAt: Math.floor(Date.now() / 1000)
                },
                {
                  name: "Missing id thread"
                }
              ]
            }
    );

    vi.doMock("node:fs", () => ({
      mkdirSync: vi.fn(),
      readFileSync,
      statSync: vi.fn(() => ({ size: 1_024 })),
      writeFileSync: vi.fn(),
      realpathSync: vi.fn((value: string) => value)
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp/codex",
        focus: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
        setLoginItemSettings: vi.fn()
      },
      BrowserWindow: {
        getFocusedWindow: vi.fn(() => null),
        getAllWindows: vi.fn(() => [])
      },
      dialog: {
        showOpenDialog: vi.fn()
      },
      Notification: {
        isSupported: () => true
      }
    }));
    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn(),
        listThreads
      }
    }));

    const { WorkspaceService } = await import("./workspace-service");
    const service = new WorkspaceService();
    const workspaceState = await service.getWorkspaceState();
    const project = workspaceState.projects.find((entry) => entry.id === "workspace-1");

    expect(project?.threads).toHaveLength(1);
    expect(project?.threads[0]?.id).toBe("thread-legacy-id");
    expect(project?.threads[0]?.title).toBe("Legacy thread");
    expect(listThreads).toHaveBeenCalledWith("/tmp/CodexRealtime", false);
  });

  it("normalizes map-shaped thread/list payloads", async () => {
    const readFileSync = vi.fn(() =>
      JSON.stringify({
        currentWorkspaceId: "workspace-1",
        workspaces: {
          "workspace-1": {
            id: "workspace-1",
            name: "CodexRealtime",
            path: "/tmp/CodexRealtime",
            lastOpenedAt: "2026-03-11T00:00:00.000Z",
            threadId: null
          }
        }
      })
    );
    const listThreads = vi.fn(async () => ({
      data: {
        "thread-map-1": {
          title: "Mapped thread",
          preview: "Mapped thread preview",
          updated_at: Math.floor(Date.now() / 1000)
        }
      }
    }));

    vi.doMock("node:fs", () => ({
      mkdirSync: vi.fn(),
      readFileSync,
      statSync: vi.fn(() => ({ size: 1_024 })),
      writeFileSync: vi.fn(),
      realpathSync: vi.fn((value: string) => value)
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp/codex",
        focus: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
        setLoginItemSettings: vi.fn()
      },
      BrowserWindow: {
        getFocusedWindow: vi.fn(() => null),
        getAllWindows: vi.fn(() => [])
      },
      dialog: {
        showOpenDialog: vi.fn()
      },
      Notification: {
        isSupported: () => true
      }
    }));
    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn(),
        listThreads
      }
    }));

    const { WorkspaceService } = await import("./workspace-service");
    const service = new WorkspaceService();
    const workspaceState = await service.getWorkspaceState();
    const project = workspaceState.projects.find((entry) => entry.id === "workspace-1");

    expect(project?.threads).toHaveLength(1);
    expect(project?.threads[0]?.id).toBe("thread-map-1");
    expect(project?.threads[0]?.title).toBe("Mapped thread");
    expect(project?.threads[0]?.preview).toBe("Mapped thread preview");
  });

  it("normalizes map-shaped payloads with primitive thread values", async () => {
    const readFileSync = vi.fn(() =>
      JSON.stringify({
        currentWorkspaceId: "workspace-1",
        workspaces: {
          "workspace-1": {
            id: "workspace-1",
            name: "CodexRealtime",
            path: "/tmp/CodexRealtime",
            lastOpenedAt: "2026-03-11T00:00:00.000Z",
            threadId: null
          }
        }
      })
    );
    const listThreads = vi.fn(async () => ({
      data: {
        "thread-primitive": "Primitive thread title"
      }
    }));

    vi.doMock("node:fs", () => ({
      mkdirSync: vi.fn(),
      readFileSync,
      statSync: vi.fn(() => ({ size: 1_024 })),
      writeFileSync: vi.fn(),
      realpathSync: vi.fn((value: string) => value)
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp/codex",
        focus: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
        setLoginItemSettings: vi.fn()
      },
      BrowserWindow: {
        getFocusedWindow: vi.fn(() => null),
        getAllWindows: vi.fn(() => [])
      },
      dialog: {
        showOpenDialog: vi.fn()
      },
      Notification: {
        isSupported: () => true
      }
    }));
    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn(),
        listThreads
      }
    }));

    const { WorkspaceService } = await import("./workspace-service");
    const service = new WorkspaceService();
    const workspaceState = await service.getWorkspaceState();
    const project = workspaceState.projects.find((entry) => entry.id === "workspace-1");

    expect(project?.threads).toHaveLength(1);
    expect(project?.threads[0]?.id).toBe("thread-primitive");
    expect(project?.threads[0]?.title).toBe("Primitive thread title");
    expect(project?.threads[0]?.preview).toBe("Primitive thread title");
  });

  it("normalizes direct thread/list array payloads", async () => {
    const readFileSync = vi.fn(() =>
      JSON.stringify({
        currentWorkspaceId: "workspace-1",
        workspaces: {
          "workspace-1": {
            id: "workspace-1",
            name: "CodexRealtime",
            path: "/tmp/CodexRealtime",
            lastOpenedAt: "2026-03-11T00:00:00.000Z",
            threadId: null
          }
        }
      })
    );
    const listThreads = vi.fn(async () => [
      {
        id: "thread-direct-array",
        title: "Direct array thread",
        updatedAt: Math.floor(Date.now() / 1000)
      }
    ]);

    vi.doMock("node:fs", () => ({
      mkdirSync: vi.fn(),
      readFileSync,
      statSync: vi.fn(() => ({ size: 1_024 })),
      writeFileSync: vi.fn(),
      realpathSync: vi.fn((value: string) => value)
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp/codex",
        focus: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
        setLoginItemSettings: vi.fn()
      },
      BrowserWindow: {
        getFocusedWindow: vi.fn(() => null),
        getAllWindows: vi.fn(() => [])
      },
      dialog: {
        showOpenDialog: vi.fn()
      },
      Notification: {
        isSupported: () => true
      }
    }));
    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn(),
        listThreads
      }
    }));

    const { WorkspaceService } = await import("./workspace-service");
    const service = new WorkspaceService();
    const workspaceState = await service.getWorkspaceState();
    const project = workspaceState.projects.find((entry) => entry.id === "workspace-1");

    expect(project?.threads).toHaveLength(1);
    expect(project?.threads[0]?.id).toBe("thread-direct-array");
    expect(project?.threads[0]?.title).toBe("Direct array thread");
    expect(listThreads).toHaveBeenCalled();
  });

  it("normalizes nested thread payload wrappers from legacy list responses", async () => {
    const readFileSync = vi.fn(() =>
      JSON.stringify({
        currentWorkspaceId: "workspace-1",
        workspaces: {
          "workspace-1": {
            id: "workspace-1",
            name: "CodexRealtime",
            path: "/tmp/CodexRealtime",
            lastOpenedAt: "2026-03-11T00:00:00.000Z",
            threadId: null
          }
        }
      })
    );
    const listThreads = vi.fn(async () => ({
      data: {
        conversations: {
          "thread-legacy-wrapper": {
            name: "Wrapped thread",
            updatedAt: Math.floor(Date.now() / 1000)
          }
        }
      }
    }));

    vi.doMock("node:fs", () => ({
      mkdirSync: vi.fn(),
      readFileSync,
      statSync: vi.fn(() => ({ size: 1_024 })),
      writeFileSync: vi.fn(),
      realpathSync: vi.fn((value: string) => value)
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp/codex",
        focus: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
        setLoginItemSettings: vi.fn()
      },
      BrowserWindow: {
        getFocusedWindow: vi.fn(() => null),
        getAllWindows: vi.fn(() => [])
      },
      dialog: {
        showOpenDialog: vi.fn()
      },
      Notification: {
        isSupported: () => true
      }
    }));
    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn(),
        listThreads
      }
    }));

    const { WorkspaceService } = await import("./workspace-service");
    const service = new WorkspaceService();
    const workspaceState = await service.getWorkspaceState();
    const project = workspaceState.projects.find((entry) => entry.id === "workspace-1");

    expect(project?.threads).toHaveLength(1);
    expect(project?.threads[0]?.id).toBe("thread-legacy-wrapper");
    expect(project?.threads[0]?.title).toBe("Wrapped thread");
  });

  it("deduplicates attachment path candidates before filesystem resolution", async () => {
    const realpathSync = vi.fn((value: string) => value.trim());
    const statSync = vi.fn(() => ({
      isFile: () => true
    }));

    vi.doMock("node:fs", () => ({
      mkdirSync: vi.fn(),
      readFileSync: vi.fn(() => JSON.stringify({ currentWorkspaceId: null, workspaces: {} })),
      writeFileSync: vi.fn(),
      realpathSync,
      statSync
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp/codex",
        focus: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
        setLoginItemSettings: vi.fn()
      },
      BrowserWindow: {
        getFocusedWindow: vi.fn(() => null),
        getAllWindows: vi.fn(() => [])
      },
      dialog: {
        showOpenDialog: vi.fn()
      },
      Notification: {
        isSupported: () => true
      }
    }));
    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn()
      }
    }));

    const { WorkspaceService } = await import("./workspace-service");
    const service = new WorkspaceService();

    const attachments = await service.addWorkerAttachments([
      " /tmp/codex/a.txt ",
      "/tmp/codex/a.txt",
      "/tmp/codex/b.txt",
      "/tmp/codex/a.txt"
    ]);

    expect(realpathSync).toHaveBeenCalledTimes(2);
    expect(statSync).toHaveBeenCalledTimes(2);
    expect(attachments).toEqual([
      {
        id: "/tmp/codex/a.txt",
        kind: "file",
        name: "a.txt",
        path: "/tmp/codex/a.txt"
      },
      {
        id: "/tmp/codex/b.txt",
        kind: "file",
        name: "b.txt",
        path: "/tmp/codex/b.txt"
      }
    ]);
  });

  it("rejects oversized attachment path candidates before filesystem access", async () => {
    const realpathSync = vi.fn((value: string) => value);
    const statSync = vi.fn(() => ({
      isFile: () => true
    }));

    vi.doMock("node:fs", () => ({
      mkdirSync: vi.fn(),
      readFileSync: vi.fn(() => JSON.stringify({ currentWorkspaceId: null, workspaces: {} })),
      writeFileSync: vi.fn(),
      realpathSync,
      statSync
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp/codex",
        focus: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
        setLoginItemSettings: vi.fn()
      },
      BrowserWindow: {
        getFocusedWindow: vi.fn(() => null),
        getAllWindows: vi.fn(() => [])
      },
      dialog: {
        showOpenDialog: vi.fn()
      },
      Notification: {
        isSupported: () => true
      }
    }));
    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn()
      }
    }));

    const { WorkspaceService } = await import("./workspace-service");
    const service = new WorkspaceService();

    const attachments = await service.addWorkerAttachments([
      `/tmp/${"x".repeat(4_100)}`,
      "/tmp/codex/ok.txt"
    ]);

    expect(realpathSync).toHaveBeenCalledTimes(1);
    expect(statSync).toHaveBeenCalledTimes(1);
    expect(attachments).toEqual([
      {
        id: "/tmp/codex/ok.txt",
        kind: "file",
        name: "ok.txt",
        path: "/tmp/codex/ok.txt"
      }
    ]);
  });

  it("ignores invalid persisted workspace maps", async () => {
    const readFileSync = vi.fn(() =>
      JSON.stringify({
        currentWorkspaceId: "workspace-1",
        workspaces: "nope"
      })
    );

    vi.doMock("node:fs", () => ({
      mkdirSync: vi.fn(),
      readFileSync,
      statSync: vi.fn(() => ({ size: 1_024 })),
      writeFileSync: vi.fn(),
      realpathSync: vi.fn((value: string) => value)
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp/codex",
        focus: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
        setLoginItemSettings: vi.fn()
      },
      BrowserWindow: {
        getFocusedWindow: vi.fn(() => null),
        getAllWindows: vi.fn(() => [])
      },
      dialog: {
        showOpenDialog: vi.fn()
      },
      Notification: {
        isSupported: () => true
      }
    }));
    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn()
      }
    }));

    const { WorkspaceService } = await import("./workspace-service");
    const service = new WorkspaceService();
    const readState = (
      service as unknown as {
        readState: () => { currentWorkspaceId: string | null; workspaces: Record<string, unknown> };
      }
    ).readState.bind(service);

    expect(readState()).toEqual({
      currentWorkspaceId: "workspace-1",
      workspaces: {}
    });
    expect(readFileSync).toHaveBeenCalledTimes(1);
  });

  it("serializes bridge-driven mutations", async () => {
    vi.doMock("node:fs", () => ({
      mkdirSync: vi.fn(),
      readFileSync: vi.fn(() => JSON.stringify({ currentWorkspaceId: null, workspaces: {} })),
      statSync: vi.fn(() => ({ size: 1_024 })),
      writeFileSync: vi.fn(),
      realpathSync: vi.fn((value: string) => value)
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp/codex",
        focus: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
        setLoginItemSettings: vi.fn()
      },
      BrowserWindow: {
        getFocusedWindow: vi.fn(() => null),
        getAllWindows: vi.fn(() => [])
      },
      dialog: {
        showOpenDialog: vi.fn()
      },
      Notification: {
        isSupported: () => true
      }
    }));
    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn()
      }
    }));

    const { WorkspaceService } = await import("./workspace-service");
    const service = new WorkspaceService();
    const enqueueBridgeMutation = (
      service as unknown as {
        enqueueBridgeMutation: (action: () => void | Promise<void>) => Promise<void>;
      }
    ).enqueueBridgeMutation.bind(service);
    const order: string[] = [];
    let releaseFirst: (() => void) | null = null;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = enqueueBridgeMutation(async () => {
      order.push("first-start");
      await firstGate;
      order.push("first-end");
    });
    const second = enqueueBridgeMutation(() => {
      order.push("second");
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["first-start"]);

    const release: () => void =
      releaseFirst ??
      (() => {
        throw new Error("Expected the first bridge mutation to be waiting");
      });

    release();
    await Promise.all([first, second]);

    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("persists pasted image blobs as image attachments", async () => {
    const mkdirSync = vi.fn();
    const writeFileSync = vi.fn();

    vi.doMock("node:fs", () => ({
      mkdirSync,
      readFileSync: vi.fn(() => JSON.stringify({ currentWorkspaceId: null, workspaces: {} })),
      writeFileSync,
      statSync: vi.fn(() => ({
        isFile: () => true
      })),
      realpathSync: vi.fn((value: string) => value)
    }));
    vi.doMock("node:crypto", () => ({
      randomUUID: vi.fn(() => "uuid-123")
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp/codex",
        focus: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
        setLoginItemSettings: vi.fn()
      },
      BrowserWindow: {
        getFocusedWindow: vi.fn(() => null),
        getAllWindows: vi.fn(() => [])
      },
      dialog: {
        showOpenDialog: vi.fn()
      },
      Notification: {
        isSupported: () => true
      }
    }));
    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn()
      }
    }));

    const { WorkspaceService } = await import("./workspace-service");
    const service = new WorkspaceService();
    const attachments = await service.addPastedImageAttachments([
      {
        name: "Screenshot.png",
        mimeType: "image/png",
        dataBase64: "AQID"
      }
    ]);

    expect(mkdirSync).toHaveBeenCalledWith("/tmp/codex/worker-attachments/pasted", {
      recursive: true
    });
    expect(writeFileSync).toHaveBeenCalledWith(
      "/tmp/codex/worker-attachments/pasted/uuid-123-Screenshot.png",
      Buffer.from("AQID", "base64")
    );
    expect(attachments).toEqual([
      {
        id: "/tmp/codex/worker-attachments/pasted/uuid-123-Screenshot.png",
        name: "uuid-123-Screenshot.png",
        path: "/tmp/codex/worker-attachments/pasted/uuid-123-Screenshot.png",
        kind: "image"
      }
    ]);
  });

  it("rejects oversized pasted image blobs", async () => {
    const mkdirSync = vi.fn();
    const writeFileSync = vi.fn();

    vi.doMock("node:fs", () => ({
      mkdirSync,
      readFileSync: vi.fn(() => JSON.stringify({ currentWorkspaceId: null, workspaces: {} })),
      writeFileSync,
      statSync: vi.fn(() => ({
        isFile: () => true
      })),
      realpathSync: vi.fn((value: string) => value)
    }));
    vi.doMock("node:crypto", () => ({
      randomUUID: vi.fn(() => "uuid-123")
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp/codex",
        focus: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
        setLoginItemSettings: vi.fn()
      },
      BrowserWindow: {
        getFocusedWindow: vi.fn(() => null),
        getAllWindows: vi.fn(() => [])
      },
      dialog: {
        showOpenDialog: vi.fn()
      },
      Notification: {
        isSupported: () => true
      }
    }));
    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn()
      }
    }));

    const { WorkspaceService } = await import("./workspace-service");
    const service = new WorkspaceService();
    const oversizedBase64 = Buffer.alloc(10 * 1024 * 1024 + 1, 1).toString("base64");
    const attachments = await service.addPastedImageAttachments([
      {
        name: "huge.png",
        mimeType: "image/png",
        dataBase64: oversizedBase64
      }
    ]);

    expect(mkdirSync).toHaveBeenCalledWith("/tmp/codex/worker-attachments/pasted", {
      recursive: true
    });
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(attachments).toEqual([]);
  });

  it("rejects malformed pasted image base64 payloads", async () => {
    const mkdirSync = vi.fn();
    const writeFileSync = vi.fn();

    vi.doMock("node:fs", () => ({
      mkdirSync,
      readFileSync: vi.fn(() => JSON.stringify({ currentWorkspaceId: null, workspaces: {} })),
      writeFileSync,
      statSync: vi.fn(() => ({
        isFile: () => true
      })),
      realpathSync: vi.fn((value: string) => value)
    }));
    vi.doMock("node:crypto", () => ({
      randomUUID: vi.fn(() => "uuid-123")
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp/codex",
        focus: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
        setLoginItemSettings: vi.fn()
      },
      BrowserWindow: {
        getFocusedWindow: vi.fn(() => null),
        getAllWindows: vi.fn(() => [])
      },
      dialog: {
        showOpenDialog: vi.fn()
      },
      Notification: {
        isSupported: () => true
      }
    }));
    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn()
      }
    }));

    const { WorkspaceService } = await import("./workspace-service");
    const service = new WorkspaceService();
    const attachments = await service.addPastedImageAttachments([
      {
        name: "bad.png",
        mimeType: "image/png",
        dataBase64: "A===A==="
      }
    ]);

    expect(mkdirSync).toHaveBeenCalledWith("/tmp/codex/worker-attachments/pasted", {
      recursive: true
    });
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(attachments).toEqual([]);
  });

  it("rejects unsupported pasted image mime types", async () => {
    const mkdirSync = vi.fn();
    const writeFileSync = vi.fn();

    vi.doMock("node:fs", () => ({
      mkdirSync,
      readFileSync: vi.fn(() => JSON.stringify({ currentWorkspaceId: null, workspaces: {} })),
      writeFileSync,
      statSync: vi.fn(() => ({
        isFile: () => true
      })),
      realpathSync: vi.fn((value: string) => value)
    }));
    vi.doMock("node:crypto", () => ({
      randomUUID: vi.fn(() => "uuid-123")
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp/codex",
        focus: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
        setLoginItemSettings: vi.fn()
      },
      BrowserWindow: {
        getFocusedWindow: vi.fn(() => null),
        getAllWindows: vi.fn(() => [])
      },
      dialog: {
        showOpenDialog: vi.fn()
      },
      Notification: {
        isSupported: () => true
      }
    }));
    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn()
      }
    }));

    const { WorkspaceService } = await import("./workspace-service");
    const service = new WorkspaceService();
    const attachments = await service.addPastedImageAttachments([
      {
        name: "vector.svg",
        mimeType: "image/svg+xml",
        dataBase64: "PHN2Zz48L3N2Zz4="
      }
    ]);

    expect(mkdirSync).toHaveBeenCalledWith("/tmp/codex/worker-attachments/pasted", {
      recursive: true
    });
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(attachments).toEqual([]);
  });

  it("emits timeline updates for live bridge command events", async () => {
    vi.doMock("node:fs", () => ({
      mkdirSync: vi.fn(),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          currentWorkspaceId: "workspace-1",
          workspaces: {
            "workspace-1": {
              id: "workspace-1",
              name: "CodexRealtime",
              path: "/tmp/CodexRealtime",
              lastOpenedAt: "2026-03-11T00:00:00.000Z",
              threadId: "thread-1"
            }
          }
        })
      ),
      statSync: vi.fn(() => ({ size: 1_024 })),
      writeFileSync: vi.fn(),
      realpathSync: vi.fn((value: string) => value)
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp/codex",
        focus: vi.fn()
      },
      BrowserWindow: {
        getFocusedWindow: vi.fn(() => null),
        getAllWindows: vi.fn(() => [])
      },
      dialog: {
        showOpenDialog: vi.fn()
      }
    }));
    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn()
      }
    }));

    const { WorkspaceService } = await import("./workspace-service");
    const service = new WorkspaceService();
    const handleBridgeNotification = (
      service as unknown as {
        handleBridgeNotification: (payload: {
          method: string;
          params?: {
            threadId?: string;
            turnId?: string;
            item?: {
              type: string;
              id?: string;
              command?: string;
              aggregatedOutput?: string | null;
            };
          };
        }) => Promise<void>;
      }
    ).handleBridgeNotification.bind(service);
    const timelineListener = vi.fn();

    service.on("timeline", timelineListener);
    await handleBridgeNotification({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "commandExecution",
          id: "command-1",
          command: "pwd",
          aggregatedOutput: null
        }
      }
    });

    expect(timelineListener).toHaveBeenCalled();
    expect(timelineListener.mock.lastCall?.[0]).toMatchObject({
      threadId: "thread-1",
      isRunning: false
    });
    expect(timelineListener.mock.lastCall?.[0].entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "command-1",
          kind: "activity",
          activityType: "command_execution",
          command: "pwd",
          label: "Ran pwd",
          createdAt: "Live update",
          status: "in_progress"
        })
      ])
    );
  });

  const createWorkRequestIntent = ({
    source,
    taskEnvelope,
    ...overrides
  }: WorkRequestIntentOverrides = {}): WorkRequestIntent => ({
    kind: "work_request",
    source: {
      sourceType: "handoff_request",
      itemId: "item-1",
      handoffId: "handoff-1",
      transcript: "Inspect the auth tests",
      metadata: {
        messages: [{ text: "Inspect the auth tests" }]
      },
      ...source
    },
    taskEnvelope: {
      workspaceId: "workspace-1",
      threadId: "thread-voice-1",
      source: "handoff_request",
      sourceItemId: "item-1",
      transcript: "Inspect the auth tests",
      userGoal: "Inspect the auth tests",
      distilledPrompt: "Inspect the auth tests, explain the root cause, and propose the smallest safe fix.",
      constraints: ["Ask before changing public APIs"],
      acceptanceCriteria: ["Explain the root cause", "Keep the patch reviewable"],
      clarificationPolicy: "request_user_input",
      replyStyle: "concise milestones + clear final summary",
      sourceMessageIds: ["item-1"],
      rawPayload: {
        messages: [{ text: "Inspect the auth tests" }]
      },
      handoffId: "handoff-1",
      ...taskEnvelope
    },
    ...overrides
  });

  const setupVoiceDispatchService = async ({
    workspaceThreadId = null,
    activeTurnId = null,
    activeTurnThreadId = activeTurnId ? workspaceThreadId : null,
    steerTurnImpl
  }: {
    workspaceThreadId?: string | null;
    activeTurnId?: string | null;
    activeTurnThreadId?: string | null;
    steerTurnImpl?: (
      threadId: string,
      expectedTurnId: string,
      prompt: string
    ) => Promise<unknown>;
  } = {}) => {
    const writeFileSync = vi.fn();
    const startTurn = vi.fn(
      async (
        threadId: string,
        input: unknown[],
        settings: unknown,
        resolvedModel: string | null
      ) => ({
        threadId,
        input,
        settings,
        resolvedModel,
        turn: {
          id: "turn-started"
        }
      })
    );
    const steerTurn = vi.fn(
      steerTurnImpl ??
        (async (
          threadId: string,
          expectedTurnId: string,
          prompt: string
        ) => ({
          threadId,
          expectedTurnId,
          prompt,
          turn: {
            id: activeTurnId ?? "turn-active"
          }
        }))
    );
    const interruptTurn = vi.fn(async () => undefined);
    const startThread = vi.fn(async () => ({
      thread: {
        id: "thread-started"
      }
    }));
    const resumeThread = vi.fn(async () => ({
      thread: {
        id: workspaceThreadId ?? "thread-resumed"
      }
    }));
    const listModels = vi.fn(async () => ({
      data: [
        {
          id: "model-gpt-5.4",
          model: "gpt-5.4",
          displayName: "gpt-5.4",
          isDefault: true,
          inputModalities: ["text"],
          supportedReasoningEfforts: [{ reasoningEffort: "xhigh" }],
          defaultReasoningEffort: "xhigh"
        }
      ]
    }));
    const readConfig = vi.fn(async () => ({
      config: {
        model: "gpt-5.4",
        model_reasoning_effort: "xhigh",
        approval_policy: "never",
        service_tier: "fast"
      }
    }));
    const readThread = vi.fn(async () => ({
      thread: {
        id: workspaceThreadId ?? "thread-started",
        turns: []
      }
    }));

    vi.doMock("node:fs", () => ({
      mkdirSync: vi.fn(),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          currentWorkspaceId: "workspace-1",
          workspaces: {
            "workspace-1": {
              id: "workspace-1",
              name: "CodexRealtime",
              path: "/tmp/CodexRealtime",
              lastOpenedAt: "2026-03-11T00:00:00.000Z",
              threadId: workspaceThreadId
            }
          }
        })
      ),
      writeFileSync,
      statSync: vi.fn(() => ({
        isFile: () => true
      })),
      realpathSync: vi.fn((value: string) => value)
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath: () => "/tmp/codex",
        focus: vi.fn(),
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
        setLoginItemSettings: vi.fn()
      },
      BrowserWindow: {
        getFocusedWindow: vi.fn(() => null),
        getAllWindows: vi.fn(() => [])
      },
      dialog: {
        showOpenDialog: vi.fn()
      },
      Notification: {
        isSupported: () => true
      }
    }));
    vi.doMock("./app-settings-service", () => ({
      appSettingsService: {
        getSettings: () => ({
          autoNameNewThreads: false
        })
      }
    }));
    vi.doMock("./codex-bridge", () => ({
      codexBridge: {
        on: vi.fn(),
        start: vi.fn(),
        startThread,
        resumeThread,
        readThread,
        listModels,
        readConfig,
        startTurn,
        steerTurn,
        interruptTurn
      }
    }));

    const { WorkspaceService } = await import("./workspace-service");
    const service = new WorkspaceService();
    (service as unknown as { activeTurnId: string | null }).activeTurnId = activeTurnId;
    (service as unknown as { activeTurnThreadId: string | null }).activeTurnThreadId =
      activeTurnThreadId;

    return {
      service,
      startTurn,
      steerTurn,
      interruptTurn,
      startThread,
      resumeThread,
      listModels,
      readConfig,
      writeFileSync
    };
  };

  it("starts a new turn for voice work requests when no turn is active", async () => {
    const { service, startTurn, startThread, steerTurn } = await setupVoiceDispatchService();
    const intent = createWorkRequestIntent();

    await service.dispatchVoiceIntent(intent);

    expect(startThread).toHaveBeenCalledWith("/tmp/CodexRealtime");
    expect(steerTurn).not.toHaveBeenCalled();
    expect(startTurn).toHaveBeenCalledTimes(1);
    const firstStartCall = startTurn.mock.calls[0];
    expect(firstStartCall).toBeDefined();
    expect(firstStartCall?.[0]).toBe("thread-started");
    const input = (firstStartCall?.[1] ?? []) as Array<{ type: string; text?: string }>;
    expect(input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("Inspect the auth tests")
        })
      ])
    );
    const firstInput = input[0];
    expect(firstInput).toMatchObject({
      type: "text"
    });
    const promptText =
      firstInput && typeof firstInput.text === "string" ? firstInput.text : "";
    expect(promptText).toContain("Structured voice handoff");
    expect(promptText).toContain("Transcript:");
    expect(promptText).toContain("User goal:");
    expect(promptText).toContain("Distilled prompt:");
    expect(promptText).toContain("Clarification policy: request_user_input");
    expect(promptText).toContain("Ask before changing public APIs");
  });

  it("steers the active turn for voice work requests when a turn is already active", async () => {
    const { service, steerTurn, startTurn, resumeThread } = await setupVoiceDispatchService({
      workspaceThreadId: "thread-existing",
      activeTurnId: "turn-active"
    });
    const intent = createWorkRequestIntent({
      source: {
        sourceType: "message",
        itemId: "message-1",
        handoffId: null,
        transcript: "Actually, inspect the auth tests first",
        metadata: null
      }
    });

    const timeline = await service.dispatchVoiceIntent(intent);

    expect(resumeThread).toHaveBeenCalledWith("thread-existing", "/tmp/CodexRealtime");
    expect(startTurn).not.toHaveBeenCalled();
    expect(steerTurn).toHaveBeenCalledWith(
      "thread-existing",
      "turn-active",
      expect.stringContaining("Structured voice handoff")
    );
    expect(timeline.runState).toEqual({
      phase: "steering",
      label: "Steering"
    });
  });

  it("falls back to starting a new turn when steering voice work fails", async () => {
    const { service, steerTurn, startTurn } = await setupVoiceDispatchService({
      workspaceThreadId: "thread-existing",
      activeTurnId: "turn-active",
      steerTurnImpl: async () => {
        throw new Error("turn not found");
      }
    });
    const intent = createWorkRequestIntent();

    await service.dispatchVoiceIntent(intent);

    expect(steerTurn).toHaveBeenCalledTimes(1);
    expect(startTurn).toHaveBeenCalledTimes(1);
  });

  it("starts a new turn when the active turn belongs to a different thread", async () => {
    const { service, steerTurn, startTurn, resumeThread } = await setupVoiceDispatchService({
      workspaceThreadId: "thread-current",
      activeTurnId: "turn-other-thread",
      activeTurnThreadId: "thread-other"
    });

    await service.dispatchVoiceIntent(createWorkRequestIntent());

    expect(resumeThread).toHaveBeenCalledWith("thread-current", "/tmp/CodexRealtime");
    expect(steerTurn).not.toHaveBeenCalled();
    expect(startTurn).toHaveBeenCalledTimes(1);
    const firstStartCall = startTurn.mock.calls[0];
    expect(firstStartCall).toBeDefined();
    expect(firstStartCall?.[0]).toBe("thread-current");
  });

  it("rethrows non-restartable steer failures instead of silently restarting", async () => {
    const { service, steerTurn, startTurn } = await setupVoiceDispatchService({
      workspaceThreadId: "thread-existing",
      activeTurnId: "turn-active",
      steerTurnImpl: async () => {
        throw new Error("permission denied");
      }
    });

    await expect(service.dispatchVoiceIntent(createWorkRequestIntent())).rejects.toThrow(
      "permission denied"
    );

    expect(steerTurn).toHaveBeenCalledTimes(1);
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("treats interrupt on another thread as an intentional no-op", async () => {
    const { service, interruptTurn, startThread, resumeThread } = await setupVoiceDispatchService({
      workspaceThreadId: "thread-current",
      activeTurnId: "turn-other-thread",
      activeTurnThreadId: "thread-other"
    });

    const timeline = await service.interruptActiveTurn();

    expect(interruptTurn).not.toHaveBeenCalled();
    expect(startThread).not.toHaveBeenCalled();
    expect(resumeThread).not.toHaveBeenCalled();
    expect(timeline.threadId).toBe("thread-current");
    expect(timeline.runState.phase).toBe("idle");
  });
});
