// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppInfo, SessionState, WorkspaceState } from "@shared";
import { LeftRail } from "./LeftRail";

const appInfo: AppInfo = {
  name: "Codex Realtime",
  version: "0.1.0",
  platform: "darwin"
};

const sessionState: SessionState = {
  status: "connected",
  account: {
    type: "chatgpt",
    planType: "pro"
  },
  features: {
    defaultModeRequestUserInput: true,
    realtimeConversation: true,
    voiceTranscription: true
  },
  requiresOpenaiAuth: false,
  error: null,
  lastUpdatedAt: "2026-03-11T08:00:00.000Z"
};

const workspaceState: WorkspaceState = {
  currentWorkspace: {
    id: "workspace-1",
    name: "AskInLine",
    path: "/tmp/AskInLine"
  },
  currentThreadId: "thread-1",
  recentWorkspaces: [],
  threads: [
    {
      id: "thread-1",
      title: "archive smoke test",
      updatedAt: "30m",
      changeSummary: null
    }
  ],
  projects: [
    {
      id: "workspace-1",
      name: "AskInLine",
      path: "/tmp/AskInLine",
      isCurrent: true,
      currentThreadId: "thread-1",
      threads: [
        {
          id: "thread-1",
          title: "archive smoke test",
          updatedAt: "30m",
          changeSummary: null
        }
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

  const renderLeftRail = async (onArchiveThread = vi.fn()) => {
    await act(async () => {
      root?.render(
        <LeftRail
          appInfo={appInfo}
          sessionState={sessionState}
          workspaceState={workspaceState}
          isOpeningWorkspace={false}
          isCreatingThread={false}
          archivingThreadId={null}
          runningThreadId={null}
          onOpenWorkspace={vi.fn()}
          onOpenCurrentWorkspace={vi.fn()}
          onCreateThread={vi.fn()}
          onSelectWorkspace={vi.fn()}
          onSelectThread={vi.fn()}
          onArchiveThread={onArchiveThread}
        />
      );
    });

    return onArchiveThread;
  };

  it("swaps time to archive then confirm before archiving", async () => {
    const onArchiveThread = await renderLeftRail();

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
});
