// @vitest-environment jsdom

import { act, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppInfo, ThreadSummary, WorkspaceState } from "@shared";
import { LeftRail } from "./LeftRail";

type CreateThreadHandler = (workspaceId: string) => void;
type RemoveWorkspaceHandler = (workspaceId: string) => void;
type ArchiveThreadHandler = (workspaceId: string, threadId: string) => void;

const appInfo: AppInfo = {
  name: "Codex Realtime",
  version: "0.1.0",
  platform: "darwin",
  availableEditors: []
};

const createThread = (
  id: string,
  title: string,
  updatedAt: string,
  overrides: Partial<ThreadSummary> = {}
): ThreadSummary => ({
  id,
  title,
  updatedAt,
  preview: null,
  changeSummary: null,
  state: "idle",
  isRunning: false,
  hasPendingApproval: false,
  hasPendingUserInput: false,
  ...overrides
});

const workspaceState: WorkspaceState = {
  currentWorkspace: {
    id: "workspace-1",
    name: "AskInLine",
    path: "/tmp/AskInLine"
  },
  currentThreadId: "thread-1",
  recentWorkspaces: [],
  threads: [
    createThread("thread-1", "archive smoke test", "30m", {
      preview: "Package the VS Code smoke path and verify the archive."
    })
  ],
  projects: [
    {
      id: "workspace-1",
      name: "AskInLine",
      path: "/tmp/AskInLine",
      isCurrent: true,
      currentThreadId: "thread-1",
      threads: [
        createThread("thread-1", "archive smoke test", "30m", {
          preview: "Package the VS Code smoke path and verify the archive."
        })
      ]
    }
  ],
  archivedProjects: []
};

describe("LeftRail", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  const renderLeftRail = async ({
    workspaceStateOverride = workspaceState,
    onArchiveThread = vi.fn<ArchiveThreadHandler>(),
    onCreateThread = vi.fn<CreateThreadHandler>(),
    onRemoveWorkspace = vi.fn<RemoveWorkspaceHandler>(),
    onOpenWorkspace = vi.fn<() => void>()
  }: {
    workspaceStateOverride?: WorkspaceState;
    onArchiveThread?: ReturnType<typeof vi.fn<ArchiveThreadHandler>>;
    onCreateThread?: ReturnType<typeof vi.fn<CreateThreadHandler>>;
    onRemoveWorkspace?: ReturnType<typeof vi.fn<RemoveWorkspaceHandler>>;
    onOpenWorkspace?: ReturnType<typeof vi.fn<() => void>>;
  } = {}) => {
    await act(async () => {
      root?.render(
        <LeftRail
          appInfo={appInfo}
          workspaceState={workspaceStateOverride}
          isOpeningWorkspace={false}
          isCreatingThread={false}
          archivingThreadId={null}
          removingWorkspaceId={null}
          runningThreadId={null}
          isSettingsView={false}
          isVoicePanelOpen={false}
          onOpenWorkspace={onOpenWorkspace}
          onCreateThread={onCreateThread as CreateThreadHandler}
          onRemoveWorkspace={onRemoveWorkspace as RemoveWorkspaceHandler}
          onOpenSettings={vi.fn()}
          onToggleVoicePanel={vi.fn()}
          onSelectWorkspace={vi.fn()}
          onSelectThread={vi.fn()}
          onArchiveThread={onArchiveThread as ArchiveThreadHandler}
        />
      );
    });

    return {
      onArchiveThread,
      onCreateThread,
      onRemoveWorkspace,
      onOpenWorkspace
    };
  };

  it("keeps the rail hierarchy compact with repo action first and threads label second", async () => {
    const { onOpenWorkspace } = await renderLeftRail({
      onOpenWorkspace: vi.fn<() => void>()
    });

    const openRepoButton = container?.querySelector(
      'button[aria-label="Open repo"]'
    ) as HTMLButtonElement | null;

    expect(openRepoButton?.textContent).toContain("Open repo");
    expect(container?.textContent).toContain("Threads");
    expect(container?.textContent).toContain("Realtime");
    expect(container?.textContent).toContain("Settings");
    expect(container?.textContent).not.toContain("Projects");
    expect(container?.textContent).not.toContain("1 thread");
    expect(container?.querySelector('button[aria-label="New thread"]')).toBeNull();

    await act(async () => {
      openRepoButton?.click();
    });

    expect(onOpenWorkspace).toHaveBeenCalledTimes(1);
  });

  it("swaps time to archive then confirm before archiving", async () => {
    const { onArchiveThread } = await renderLeftRail();

    const threadRow = container?.querySelector('[data-thread-id="thread-1"]') as HTMLDivElement | null;
    const timeSlot = threadRow?.querySelector(".project-thread-time-slot") as HTMLSpanElement | null;

    expect(threadRow).not.toBeNull();
    if (!threadRow) {
      throw new Error("Thread row not rendered");
    }
    expect(timeSlot?.textContent).toContain("30m");
    expect(threadRow.className).not.toContain("project-thread-row-hovered");
    expect(
      container?.querySelector('button[aria-label="Confirm archive archive smoke test"]')
    ).toBeNull();

    await act(async () => {
      threadRow?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    expect(threadRow.className).toContain("project-thread-row-hovered");

    const archiveButton = container?.querySelector(
      'button[aria-label="Archive archive smoke test"]'
    ) as HTMLButtonElement | null;
    expect(archiveButton).not.toBeNull();

    await act(async () => {
      archiveButton?.click();
    });

    const confirmButton = container?.querySelector(
      'button[aria-label="Confirm archive archive smoke test"]'
    ) as HTMLButtonElement | null;
    expect(confirmButton).not.toBeNull();
    expect(container?.querySelector('button[aria-label="Archive archive smoke test"]')).toBeNull();
    expect(timeSlot?.textContent).not.toContain("30m");

    await act(async () => {
      confirmButton?.click();
    });

    expect(onArchiveThread).toHaveBeenCalledTimes(1);
    expect(onArchiveThread).toHaveBeenCalledWith("workspace-1", "thread-1");
  });

  it("creates a new thread from the project row action", async () => {
    const { onCreateThread } = await renderLeftRail({
      onCreateThread: vi.fn<CreateThreadHandler>()
    });

    const button = container?.querySelector(
      'button[aria-label="New thread in AskInLine"]'
    ) as HTMLButtonElement | null;

    expect(button).not.toBeNull();

    await act(async () => {
      button?.click();
    });

    expect(onCreateThread).toHaveBeenCalledTimes(1);
    expect(onCreateThread).toHaveBeenCalledWith("workspace-1");
  });

  it("does not schedule an extra commit when the current project is already expanded", async () => {
    const commitPhases: string[] = [];
    const refreshedWorkspaceState: WorkspaceState = {
      ...workspaceState,
      threads: workspaceState.threads.map((thread) => ({ ...thread })),
      projects: workspaceState.projects.map((project) => ({
        ...project,
        threads: project.threads.map((thread) => ({ ...thread }))
      }))
    };

    await act(async () => {
      root?.render(
        <Profiler
          id="left-rail"
          onRender={(_id, phase) => {
            commitPhases.push(phase);
          }}
        >
          <LeftRail
            appInfo={appInfo}
            workspaceState={workspaceState}
            isOpeningWorkspace={false}
            isCreatingThread={false}
            archivingThreadId={null}
            removingWorkspaceId={null}
            runningThreadId={null}
            isSettingsView={false}
            isVoicePanelOpen={false}
            onOpenWorkspace={vi.fn()}
            onCreateThread={vi.fn<CreateThreadHandler>()}
            onRemoveWorkspace={vi.fn<RemoveWorkspaceHandler>()}
            onOpenSettings={vi.fn()}
            onSelectWorkspace={vi.fn()}
            onSelectThread={vi.fn()}
            onToggleVoicePanel={vi.fn()}
            onArchiveThread={vi.fn<ArchiveThreadHandler>()}
          />
        </Profiler>
      );
    });

    const baselineCommitCount = commitPhases.length;

    await act(async () => {
      root?.render(
        <Profiler
          id="left-rail"
          onRender={(_id, phase) => {
            commitPhases.push(phase);
          }}
        >
          <LeftRail
            appInfo={appInfo}
            workspaceState={refreshedWorkspaceState}
            isOpeningWorkspace={false}
            isCreatingThread={false}
            archivingThreadId={null}
            removingWorkspaceId={null}
            runningThreadId={null}
            isSettingsView={false}
            isVoicePanelOpen={false}
            onOpenWorkspace={vi.fn()}
            onCreateThread={vi.fn<CreateThreadHandler>()}
            onRemoveWorkspace={vi.fn<RemoveWorkspaceHandler>()}
            onOpenSettings={vi.fn()}
            onSelectWorkspace={vi.fn()}
            onSelectThread={vi.fn()}
            onToggleVoicePanel={vi.fn()}
            onArchiveThread={vi.fn<ArchiveThreadHandler>()}
          />
        </Profiler>
      );
    });

    expect(commitPhases.length - baselineCommitCount).toBe(1);
  });

  it("opens the project menu and removes the project", async () => {
    const { onRemoveWorkspace } = await renderLeftRail({
      onRemoveWorkspace: vi.fn<RemoveWorkspaceHandler>()
    });

    const moreButton = container?.querySelector(
      'button[aria-label="More actions for AskInLine"]'
    ) as HTMLButtonElement | null;

    expect(moreButton).not.toBeNull();

    await act(async () => {
      moreButton?.click();
    });

    const removeButton = Array.from(container?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("Remove project")
    ) as HTMLButtonElement | undefined;

    expect(removeButton).toBeDefined();

    await act(async () => {
      removeButton?.click();
    });

    expect(onRemoveWorkspace).toHaveBeenCalledTimes(1);
    expect(onRemoveWorkspace).toHaveBeenCalledWith("workspace-1");
  });

  it("caps project threads and lets the current thread break into the preview set", async () => {
    const manyThreads = Array.from({ length: 8 }, (_, index) =>
      createThread(`thread-${index + 1}`, `thread ${index + 1}`, `${index + 1}m`, {
        preview: `Preview ${index + 1}`,
        ...(index === 7
          ? {
              state: "approval",
              hasPendingApproval: true
            }
          : {})
      })
    );
    const workspaceStateOverride: WorkspaceState = {
      ...workspaceState,
      currentThreadId: "thread-8",
      threads: manyThreads,
      projects: [
        {
          ...workspaceState.projects[0],
          currentThreadId: "thread-8",
          threads: manyThreads
        }
      ]
    };

    await renderLeftRail({ workspaceStateOverride });

    expect(container?.textContent).toContain("Show 2 more");
    expect(container?.querySelector('[data-thread-id="thread-8"]')).not.toBeNull();
    expect(container?.textContent).toContain("Approval");
    expect(container?.textContent).toContain("thread 8");
    expect(container?.querySelector('[data-thread-id="thread-7"]')).toBeNull();

    const showMoreButton = Array.from(container?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("Show 2 more")
    ) as HTMLButtonElement | undefined;

    expect(showMoreButton).toBeDefined();

    await act(async () => {
      showMoreButton?.click();
    });

    expect(container?.textContent).toContain("Show less");
    expect(container?.querySelector('[data-thread-id="thread-7"]')).not.toBeNull();
  });
});
