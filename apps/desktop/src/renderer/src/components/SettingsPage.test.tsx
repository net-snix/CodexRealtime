// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppInfo,
  AppSettingsState,
  SessionState,
  ThreadSummary,
  TimelineState,
  WorkerSettingsState,
  WorkspaceState
} from "@shared";
import { SettingsPage } from "./SettingsPage";

const makeThreadSummary = (overrides: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id: "thread-1",
  title: "Main thread",
  updatedAt: "5m",
  preview: null,
  changeSummary: null,
  state: "idle",
  isRunning: false,
  hasPendingApproval: false,
  hasPendingUserInput: false,
  ...overrides
});

const appInfo: AppInfo = {
  name: "Codex Realtime",
  version: "0.1.0",
  platform: "darwin"
};

const appSettingsState: AppSettingsState = {
  settings: {
    launchAtLogin: false,
    restoreLastWorkspace: true,
    reopenLastThread: true,
    autoNameNewThreads: false,
    autoStartVoice: false,
    showVoiceCaptions: true,
    density: "comfortable",
    reduceMotion: false,
    desktopNotifications: true,
    notifyOnApprovals: true,
    notifyOnTurnComplete: true,
    notifyOnErrors: true,
    developerMode: false
  },
  userDataPath: "/tmp/codex-realtime",
  loginItemSupported: true,
  notificationsSupported: true
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
  lastUpdatedAt: "2026-03-11T10:00:00.000Z"
};

const workspaceState: WorkspaceState = {
  currentWorkspace: {
    id: "workspace-1",
    name: "AskInLine",
    path: "/tmp/AskInLine"
  },
  currentThreadId: "thread-1",
  recentWorkspaces: [
    {
      id: "workspace-1",
      name: "AskInLine",
      path: "/tmp/AskInLine"
    }
  ],
  threads: [
    makeThreadSummary()
  ],
  projects: [
    {
      id: "workspace-1",
      name: "AskInLine",
      path: "/tmp/AskInLine",
      isCurrent: true,
      currentThreadId: "thread-1",
      threads: [makeThreadSummary()]
    }
  ],
  archivedProjects: [
    {
      id: "workspace-2",
      name: "CodexRealtime",
      path: "/tmp/CodexRealtime",
      isCurrent: false,
      currentThreadId: null,
      threads: [
        makeThreadSummary({
          id: "thread-archived",
          title: "Archived thread",
          updatedAt: "2d"
        })
      ]
    }
  ]
};

const timelineState: TimelineState = {
  threadId: "thread-1",
  entries: [],
  activePlan: null,
  latestProposedPlan: null,
  turnDiffs: [],
  activeDiffPreview: null,
  approvals: [],
  userInputs: [],
  isRunning: false,
  runState: {
    phase: "idle",
    label: "Idle"
  },
  activeWorkStartedAt: null,
  latestTurn: null
};

const workerSettingsState: WorkerSettingsState = {
  settings: {
    model: "gpt-5.4",
    reasoningEffort: "xhigh",
    fastMode: true,
    approvalPolicy: "never",
    collaborationMode: "default"
  },
  models: [
    {
      id: "gpt-5.4",
      model: "gpt-5.4",
      label: "GPT-5.4",
      description: "Primary worker model",
      isDefault: true,
      supportsImageInput: true,
      supportedReasoningEfforts: ["medium", "high", "xhigh"],
      defaultReasoningEffort: "xhigh"
    }
  ],
  collaborationModes: [
    {
      mode: "default",
      label: "Code",
      name: "Code",
      model: "gpt-5.4",
      reasoningEffort: "xhigh"
    },
    {
      mode: "plan",
      label: "Plan",
      name: "Plan",
      model: "gpt-5.4",
      reasoningEffort: "xhigh"
    }
  ]
};

describe("SettingsPage", () => {
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

  it("renders sections and wires key actions", async () => {
    const onUpdateAppSettings = vi.fn();
    const onUnarchiveThread = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root?.render(
        <SettingsPage
          appInfo={appInfo}
          appSettingsState={appSettingsState}
          isUpdatingAppSettings={false}
          onUpdateAppSettings={onUpdateAppSettings}
          sessionState={sessionState}
          workspaceState={workspaceState}
          timelineState={timelineState}
          workerSettingsState={workerSettingsState}
          isUpdatingWorkerSettings={false}
          onUpdateWorkerSettings={vi.fn()}
          inputDevices={[{ id: "", label: "System default input" }]}
          outputDevices={[{ id: "", label: "System default output" }]}
          selectedInputDeviceId=""
          selectedOutputDeviceId=""
          supportsOutputSelection={true}
          onInputDeviceChange={vi.fn()}
          onOutputDeviceChange={vi.fn()}
          shouldShowDeviceHint={true}
          onDismissDeviceHint={vi.fn()}
          onResetVoicePreferences={vi.fn()}
          archivingThreadId={null}
          restoringThreadId={null}
          archiveError={null}
          onArchiveThread={vi.fn()}
          onUnarchiveThread={onUnarchiveThread}
          onOpenUserDataDirectory={vi.fn()}
          onClearRecentWorkspaces={vi.fn()}
          onClose={onClose}
        />
      );
    });

    expect(container?.textContent).toContain("App preferences");
    expect(container?.textContent).toContain("Voice");
    expect(container?.textContent).toContain("Workers");
    expect(container?.textContent).toContain("Archived thread");
    expect(container?.querySelector(".settings-page-actions .status-pill")).toBeNull();
    expect(container?.querySelector(".settings-sidebar-card")).toBeNull();

    const launchSwitch = container?.querySelector('button[role="switch"]') as HTMLButtonElement | null;
    expect(launchSwitch).not.toBeNull();

    await act(async () => {
      launchSwitch?.click();
    });

    expect(onUpdateAppSettings).toHaveBeenCalledWith({ launchAtLogin: true });

    const autoNameSwitch = Array.from(container?.querySelectorAll('button[role="switch"]') ?? []).find(
      (button) => button.getAttribute("aria-label") === "Auto-name new chats"
    ) as HTMLButtonElement | undefined;

    expect(autoNameSwitch).toBeDefined();

    await act(async () => {
      autoNameSwitch?.click();
    });

    expect(onUpdateAppSettings).toHaveBeenCalledWith({ autoNameNewThreads: true });

    const restoreButton = Array.from(container?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("Restore")
    ) as HTMLButtonElement | undefined;

    expect(restoreButton).toBeDefined();

    await act(async () => {
      restoreButton?.click();
    });

    expect(onUnarchiveThread).toHaveBeenCalledWith("workspace-2", "thread-archived");

    const backButton = Array.from(container?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("Back to thread")
    ) as HTMLButtonElement | undefined;

    expect(backButton?.closest(".settings-sidebar")).not.toBeNull();
    expect(backButton?.querySelector("svg")).not.toBeNull();

    await act(async () => {
      backButton?.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
