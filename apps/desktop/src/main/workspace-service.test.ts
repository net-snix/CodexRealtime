import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  it("bounds the thread change cache", async () => {
    vi.doMock("node:fs", () => ({
      mkdirSync: vi.fn(),
      readFileSync: vi.fn(() => JSON.stringify({ currentWorkspaceId: null, workspaces: {} })),
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

  it("serializes bridge-driven mutations", async () => {
    vi.doMock("node:fs", () => ({
      mkdirSync: vi.fn(),
      readFileSync: vi.fn(() => JSON.stringify({ currentWorkspaceId: null, workspaces: {} })),
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
          kind: "work",
          command: "pwd",
          label: "Ran pwd",
          createdAt: "Live start"
        })
      ])
    );
  });
});
