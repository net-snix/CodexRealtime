// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RealtimeState,
  ThreadSummary,
  TimelineMessageEntry,
  TimelineState,
  TimelineWorkEntry,
  WorkerSettingsState,
  WorkspaceState
} from "@shared";
import * as timelinePresenter from "../timeline-presenter";
import { Timeline } from "./Timeline";

const makeThreadSummary = (overrides: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id: "thread-1",
  title: "New thread",
  updatedAt: "now",
  preview: null,
  changeSummary: null,
  state: "idle",
  isRunning: false,
  hasPendingApproval: false,
  hasPendingUserInput: false,
  ...overrides
});

const makeMessageEntry = (
  overrides: Partial<TimelineMessageEntry> = {}
): TimelineMessageEntry => ({
  id: "entry-1",
  kind: "message",
  role: "assistant",
  text: "Hello",
  createdAt: "now",
  completedAt: null,
  turnId: "turn-1",
  summary: null,
  isStreaming: false,
  providerLabel: null,
  ...overrides
});

const makeWorkEntry = (overrides: Partial<TimelineWorkEntry> = {}): TimelineWorkEntry => ({
  id: "work-1",
  kind: "activity",
  activityType: "command_execution",
  createdAt: "now",
  turnId: "turn-1",
  tone: "tool",
  label: "Ran command",
  detail: null,
  command: null,
  changedFiles: [],
  status: null,
  toolName: null,
  agentLabel: null,
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
  archivedProjects: []
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

const realtimeState: RealtimeState = {
  status: "idle",
  threadId: null,
  sessionId: null,
  error: null
};

const workerSettingsState: WorkerSettingsState = {
  settings: {
    model: "gpt-5.4",
    reasoningEffort: "xhigh",
    fastMode: false,
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

describe("Timeline", () => {
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

  it("shows the centered new-thread prompt when no turns exist", async () => {
    await act(async () => {
      root?.render(
        <Timeline
          timelineState={timelineState}
          workspaceState={workspaceState}
          isStartingTurn={false}
          isResolvingRequests={false}
          realtimeState={realtimeState}
          voiceState="idle"
          isVoiceActive={false}
          liveTranscript={[]}
          workerSettingsState={workerSettingsState}
          workerAttachments={[]}
          isUpdatingWorkerSettings={false}
          isPickingAttachments={false}
          submittingApprovals={{}}
          approvalErrors={{}}
          submittingUserInputs={{}}
          userInputErrors={{}}
          onStartTurn={vi.fn()}
          onApproveRequest={vi.fn()}
          onDenyRequest={vi.fn()}
          onSubmitUserInput={vi.fn()}
          onUpdateWorkerSettings={vi.fn().mockResolvedValue(workerSettingsState)}
          onPickAttachments={vi.fn().mockResolvedValue([])}
          onAddAttachments={vi.fn().mockResolvedValue([])}
          onAddPastedImageAttachments={vi.fn().mockResolvedValue([])}
          onRemoveAttachment={vi.fn()}
        />
      );
    });

    expect(container?.textContent).toContain("Send a message to start working");
    expect(container?.textContent).not.toContain("No turns yet.");
    expect(container?.textContent).not.toContain("Thread");
    expect(container?.textContent).not.toContain("Idle");
  });

  it("shows a centered repo CTA when no workspace is selected", async () => {
    const onOpenWorkspace = vi.fn();

    await act(async () => {
      root?.render(
        <Timeline
          timelineState={timelineState}
          workspaceState={{
            currentWorkspace: null,
            currentThreadId: null,
            recentWorkspaces: [],
            threads: [],
            projects: [],
            archivedProjects: []
          }}
          isStartingTurn={false}
          isOpeningWorkspace={false}
          isResolvingRequests={false}
          realtimeState={realtimeState}
          voiceState="idle"
          isVoiceActive={false}
          liveTranscript={[]}
          workerSettingsState={workerSettingsState}
          workerAttachments={[]}
          isUpdatingWorkerSettings={false}
          isPickingAttachments={false}
          submittingApprovals={{}}
          approvalErrors={{}}
          submittingUserInputs={{}}
          userInputErrors={{}}
          onStartTurn={vi.fn()}
          onOpenWorkspace={onOpenWorkspace}
          onApproveRequest={vi.fn()}
          onDenyRequest={vi.fn()}
          onSubmitUserInput={vi.fn()}
          onUpdateWorkerSettings={vi.fn().mockResolvedValue(workerSettingsState)}
          onPickAttachments={vi.fn().mockResolvedValue([])}
          onAddAttachments={vi.fn().mockResolvedValue([])}
          onAddPastedImageAttachments={vi.fn().mockResolvedValue([])}
          onRemoveAttachment={vi.fn()}
        />
      );
    });

    expect(container?.textContent).toContain("Open a repo to get started");
    expect(container?.textContent).toContain("Add repo");
    expect(container?.textContent).not.toContain("Workspace");
    expect(container?.textContent).not.toContain("Open a repo.");

    const addRepoButton = Array.from(container?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("Add repo")
    );
    expect(addRepoButton).toBeDefined();

    await act(async () => {
      addRepoButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenWorkspace).toHaveBeenCalledTimes(1);
  });

  it("renders assistant markdown-style text with lists and inline code", async () => {
    await act(async () => {
      root?.render(
        <Timeline
          timelineState={{
            ...timelineState,
            entries: [
              makeMessageEntry({
                id: "event-1",
                text: "Plan:\n1. Run `build`\n2. Ship the fix"
              })
            ]
          }}
          workspaceState={workspaceState}
          isStartingTurn={false}
          isResolvingRequests={false}
          realtimeState={realtimeState}
          voiceState="idle"
          isVoiceActive={false}
          liveTranscript={[]}
          workerSettingsState={workerSettingsState}
          workerAttachments={[]}
          isUpdatingWorkerSettings={false}
          isPickingAttachments={false}
          submittingApprovals={{}}
          approvalErrors={{}}
          submittingUserInputs={{}}
          userInputErrors={{}}
          onStartTurn={vi.fn()}
          onApproveRequest={vi.fn()}
          onDenyRequest={vi.fn()}
          onSubmitUserInput={vi.fn()}
          onUpdateWorkerSettings={vi.fn().mockResolvedValue(workerSettingsState)}
          onPickAttachments={vi.fn().mockResolvedValue([])}
          onAddAttachments={vi.fn().mockResolvedValue([])}
          onAddPastedImageAttachments={vi.fn().mockResolvedValue([])}
          onRemoveAttachment={vi.fn()}
        />
      );
    });

    const orderedList = container?.querySelector("ol");
    const inlineCode = container?.querySelector(".timeline-rich-text-inline-code");

    expect(container?.textContent).toContain("Plan:");
    expect(orderedList?.querySelectorAll("li")).toHaveLength(2);
    expect(inlineCode?.textContent).toBe("build");
  });

  it("renders inspector targets in the top-right and forwards pane actions", async () => {
    const onToggleRightPane = vi.fn();
    const onOpenPane = vi.fn();

    await act(async () => {
      root?.render(
        <Timeline
          timelineState={{
            ...timelineState,
            latestProposedPlan: {
              id: "plan-1",
              createdAt: "now",
              updatedAt: "now",
              turnId: "turn-1",
              title: "Plan",
              text: "1. Tighten layout",
              steps: [{ step: "Tighten layout", status: "pending" }]
            },
            turnDiffs: [
              {
                id: "diff-1",
                kind: "diffSummary",
                createdAt: "now",
                turnId: "turn-1",
                assistantMessageId: null,
                title: "Edited 1 file",
                diff: "@@\n+hello\n-world",
                files: [
                  {
                    path: "apps/desktop/src/renderer/src/components/Timeline.tsx",
                    additions: 1,
                    deletions: 1,
                    diff: "@@\n+hello\n-world"
                  }
                ],
                additions: 1,
                deletions: 1
              }
            ],
            activeDiffPreview: {
              id: "diff-1",
              kind: "diffSummary",
              createdAt: "now",
              turnId: "turn-1",
              assistantMessageId: null,
              title: "Edited 1 file",
              diff: "@@\n+hello\n-world",
              files: [
                {
                  path: "apps/desktop/src/renderer/src/components/Timeline.tsx",
                  additions: 1,
                  deletions: 1,
                  diff: "@@\n+hello\n-world"
                }
              ],
              additions: 1,
              deletions: 1
            }
          }}
          workspaceState={workspaceState}
          isStartingTurn={false}
          activePane="plan"
          isRightPaneOpen={true}
          isResolvingRequests={false}
          realtimeState={realtimeState}
          voiceState="idle"
          isVoiceActive={false}
          liveTranscript={[]}
          workerSettingsState={workerSettingsState}
          workerAttachments={[]}
          isUpdatingWorkerSettings={false}
          isPickingAttachments={false}
          submittingApprovals={{}}
          approvalErrors={{}}
          submittingUserInputs={{}}
          userInputErrors={{}}
          onStartTurn={vi.fn()}
          onToggleRightPane={onToggleRightPane}
          onOpenPane={onOpenPane}
          onApproveRequest={vi.fn()}
          onDenyRequest={vi.fn()}
          onSubmitUserInput={vi.fn()}
          onUpdateWorkerSettings={vi.fn().mockResolvedValue(workerSettingsState)}
          onPickAttachments={vi.fn().mockResolvedValue([])}
          onAddAttachments={vi.fn().mockResolvedValue([])}
          onAddPastedImageAttachments={vi.fn().mockResolvedValue([])}
          onRemoveAttachment={vi.fn()}
        />
      );
    });

    const toggleButton = container?.querySelector(
      'button[aria-label="Hide right pane"]'
    ) as HTMLButtonElement | null;
    const diffButton = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.includes("Diff")
    ) as HTMLButtonElement | undefined;

    expect(container?.textContent).toContain("Plan");
    expect(diffButton?.textContent).toContain("Diff");
    expect(toggleButton?.textContent).toContain("Hide");

    await act(async () => {
      diffButton?.click();
    });

    expect(onOpenPane).toHaveBeenCalledWith("diff");

    await act(async () => {
      toggleButton?.click();
    });

    expect(onToggleRightPane).toHaveBeenCalledTimes(1);
  });

  it("groups consecutive command rows into a command cluster", async () => {
    await act(async () => {
      root?.render(
        <Timeline
          timelineState={{
            ...timelineState,
            entries: [
              makeWorkEntry({
                id: "command-1",
                label: "Ran /bin/zsh -lc pwd",
                command: "pwd"
              }),
              makeWorkEntry({
                id: "command-2",
                label: "Ran /bin/zsh -lc 'rg --files -g AGENTS.md'",
                command: "rg --files"
              }),
              makeWorkEntry({
                id: "command-3",
                label: "Ran /bin/zsh -lc 'find .. -name AGENTS.md -print'",
                command: "find .. -name AGENTS.md -print"
              })
            ]
          }}
          workspaceState={workspaceState}
          isStartingTurn={false}
          isResolvingRequests={false}
          realtimeState={realtimeState}
          voiceState="idle"
          isVoiceActive={false}
          liveTranscript={[]}
          workerSettingsState={workerSettingsState}
          workerAttachments={[]}
          isUpdatingWorkerSettings={false}
          isPickingAttachments={false}
          submittingApprovals={{}}
          approvalErrors={{}}
          submittingUserInputs={{}}
          userInputErrors={{}}
          onStartTurn={vi.fn()}
          onApproveRequest={vi.fn()}
          onDenyRequest={vi.fn()}
          onSubmitUserInput={vi.fn()}
          onUpdateWorkerSettings={vi.fn().mockResolvedValue(workerSettingsState)}
          onPickAttachments={vi.fn().mockResolvedValue([])}
          onAddAttachments={vi.fn().mockResolvedValue([])}
          onAddPastedImageAttachments={vi.fn().mockResolvedValue([])}
          onRemoveAttachment={vi.fn()}
        />
      );
    });

    const cluster = container?.querySelector<HTMLDetailsElement>(".timeline-command-cluster");
    const nestedItems = container?.querySelectorAll(".timeline-command-cluster-item");

    expect(cluster).not.toBeNull();
    expect(cluster?.textContent).toContain("3 commands");
    expect(nestedItems).toHaveLength(3);
  });

  it("promotes live command rows into a cluster as soon as the second command arrives", async () => {
    const liveCommandState: TimelineState = {
      ...timelineState,
      isRunning: true,
      runState: {
        phase: "running",
        label: "Working"
      },
      entries: [
        makeWorkEntry({
          id: "command-1",
          createdAt: "Live start",
          label: "Ran /bin/zsh -lc pwd",
          command: "pwd"
        })
      ]
    };

    await act(async () => {
      root?.render(
        <Timeline
          timelineState={liveCommandState}
          workspaceState={workspaceState}
          isStartingTurn={false}
          isResolvingRequests={false}
          realtimeState={realtimeState}
          voiceState="idle"
          isVoiceActive={false}
          liveTranscript={[]}
          workerSettingsState={workerSettingsState}
          workerAttachments={[]}
          isUpdatingWorkerSettings={false}
          isPickingAttachments={false}
          submittingApprovals={{}}
          approvalErrors={{}}
          submittingUserInputs={{}}
          userInputErrors={{}}
          onStartTurn={vi.fn()}
          onApproveRequest={vi.fn()}
          onDenyRequest={vi.fn()}
          onSubmitUserInput={vi.fn()}
          onUpdateWorkerSettings={vi.fn().mockResolvedValue(workerSettingsState)}
          onPickAttachments={vi.fn().mockResolvedValue([])}
          onAddAttachments={vi.fn().mockResolvedValue([])}
          onAddPastedImageAttachments={vi.fn().mockResolvedValue([])}
          onRemoveAttachment={vi.fn()}
        />
      );
    });

    expect(container?.querySelector(".timeline-command-cluster")).toBeNull();

    await act(async () => {
      root?.render(
        <Timeline
          timelineState={{
            ...liveCommandState,
            entries: [
              ...liveCommandState.entries,
              makeWorkEntry({
                id: "command-2",
                createdAt: "Live start",
                label: "Ran /bin/zsh -lc 'rg --files -g AGENTS.md'",
                command: "rg --files"
              })
            ]
          }}
          workspaceState={workspaceState}
          isStartingTurn={false}
          isResolvingRequests={false}
          realtimeState={realtimeState}
          voiceState="idle"
          isVoiceActive={false}
          liveTranscript={[]}
          workerSettingsState={workerSettingsState}
          workerAttachments={[]}
          isUpdatingWorkerSettings={false}
          isPickingAttachments={false}
          submittingApprovals={{}}
          approvalErrors={{}}
          submittingUserInputs={{}}
          userInputErrors={{}}
          onStartTurn={vi.fn()}
          onApproveRequest={vi.fn()}
          onDenyRequest={vi.fn()}
          onSubmitUserInput={vi.fn()}
          onUpdateWorkerSettings={vi.fn().mockResolvedValue(workerSettingsState)}
          onPickAttachments={vi.fn().mockResolvedValue([])}
          onAddAttachments={vi.fn().mockResolvedValue([])}
          onAddPastedImageAttachments={vi.fn().mockResolvedValue([])}
          onRemoveAttachment={vi.fn()}
        />
      );
    });

    const cluster = container?.querySelector<HTMLDetailsElement>(".timeline-command-cluster");
    const nestedItems = container?.querySelectorAll(".timeline-command-cluster-item");

    expect(cluster?.textContent).toContain("2 commands");
    expect(nestedItems).toHaveLength(2);
  });

  it("does not recompute event presentations when unrelated props change", async () => {
    const presentSpy = vi.spyOn(timelinePresenter, "presentTimelineEvent");
    const populatedTimelineState: TimelineState = {
      ...timelineState,
      isRunning: true,
      runState: {
        phase: "running",
        label: "Working"
      },
      entries: [
        makeWorkEntry({
          id: "event-1",
          tone: "info",
          label: "Ran pnpm test"
        }),
        makeMessageEntry({
          id: "event-2",
          text: "Tests passed"
        })
      ]
    };

    await act(async () => {
      root?.render(
        <Timeline
          timelineState={populatedTimelineState}
          workspaceState={workspaceState}
          isStartingTurn={false}
          isResolvingRequests={false}
          realtimeState={realtimeState}
          voiceState="idle"
          isVoiceActive={false}
          liveTranscript={[]}
          workerSettingsState={workerSettingsState}
          workerAttachments={[]}
          isUpdatingWorkerSettings={false}
          isPickingAttachments={false}
          submittingApprovals={{}}
          approvalErrors={{}}
          submittingUserInputs={{}}
          userInputErrors={{}}
          onStartTurn={vi.fn()}
          onApproveRequest={vi.fn()}
          onDenyRequest={vi.fn()}
          onSubmitUserInput={vi.fn()}
          onUpdateWorkerSettings={vi.fn().mockResolvedValue(workerSettingsState)}
          onPickAttachments={vi.fn().mockResolvedValue([])}
          onAddAttachments={vi.fn().mockResolvedValue([])}
          onAddPastedImageAttachments={vi.fn().mockResolvedValue([])}
          onRemoveAttachment={vi.fn()}
        />
      );
    });

    const initialCallCount = presentSpy.mock.calls.length;

    await act(async () => {
      root?.render(
        <Timeline
          timelineState={populatedTimelineState}
          workspaceState={workspaceState}
          isStartingTurn={false}
          isResolvingRequests={false}
          realtimeState={{ ...realtimeState, status: "connecting" }}
          voiceState="idle"
          isVoiceActive={false}
          liveTranscript={[]}
          workerSettingsState={workerSettingsState}
          workerAttachments={[]}
          isUpdatingWorkerSettings={false}
          isPickingAttachments={false}
          submittingApprovals={{}}
          approvalErrors={{}}
          submittingUserInputs={{}}
          userInputErrors={{}}
          onStartTurn={vi.fn()}
          onApproveRequest={vi.fn()}
          onDenyRequest={vi.fn()}
          onSubmitUserInput={vi.fn()}
          onUpdateWorkerSettings={vi.fn().mockResolvedValue(workerSettingsState)}
          onPickAttachments={vi.fn().mockResolvedValue([])}
          onAddAttachments={vi.fn().mockResolvedValue([])}
          onAddPastedImageAttachments={vi.fn().mockResolvedValue([])}
          onRemoveAttachment={vi.fn()}
        />
      );
    });

    expect(presentSpy).toHaveBeenCalled();
    expect(presentSpy.mock.calls).toHaveLength(initialCallCount);
  });

  it("turns pasted local file links into attachments", async () => {
    const onAddAttachments = vi.fn().mockResolvedValue([]);
    const onAddPastedImageAttachments = vi.fn().mockResolvedValue([]);

    await act(async () => {
      root?.render(
        <Timeline
          timelineState={timelineState}
          workspaceState={workspaceState}
          isStartingTurn={false}
          isResolvingRequests={false}
          realtimeState={realtimeState}
          voiceState="idle"
          isVoiceActive={false}
          liveTranscript={[]}
          workerSettingsState={workerSettingsState}
          workerAttachments={[]}
          isUpdatingWorkerSettings={false}
          isPickingAttachments={false}
          submittingApprovals={{}}
          approvalErrors={{}}
          submittingUserInputs={{}}
          userInputErrors={{}}
          onStartTurn={vi.fn()}
          onApproveRequest={vi.fn()}
          onDenyRequest={vi.fn()}
          onSubmitUserInput={vi.fn()}
          onUpdateWorkerSettings={vi.fn().mockResolvedValue(workerSettingsState)}
          onPickAttachments={vi.fn().mockResolvedValue([])}
          onAddAttachments={onAddAttachments}
          onAddPastedImageAttachments={onAddPastedImageAttachments}
          onRemoveAttachment={vi.fn()}
        />
      );
    });

    const input = container?.querySelector<HTMLInputElement>(".timeline-input");
    expect(input).not.toBeNull();

    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        files: [],
        items: [],
        getData: (type: string) =>
          type === "text/plain" ? "file:///Users/espenmac/Pictures/example.png" : ""
      }
    });

    await act(async () => {
      input?.dispatchEvent(pasteEvent);
      await Promise.resolve();
    });

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(onAddAttachments).toHaveBeenCalledWith(["/Users/espenmac/Pictures/example.png"]);
    expect(onAddPastedImageAttachments).not.toHaveBeenCalled();
  });

  it("turns pasted image blobs into image attachments", async () => {
    const onAddAttachments = vi.fn().mockResolvedValue([]);
    const onAddPastedImageAttachments = vi.fn().mockResolvedValue([]);
    const pastedImage = {
      name: "Screenshot 2026-03-11 at 14.27.00.png",
      type: "image/png",
      size: 3,
      lastModified: 1,
      arrayBuffer: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3]).buffer)
    };

    await act(async () => {
      root?.render(
        <Timeline
          timelineState={timelineState}
          workspaceState={workspaceState}
          isStartingTurn={false}
          isResolvingRequests={false}
          realtimeState={realtimeState}
          voiceState="idle"
          isVoiceActive={false}
          liveTranscript={[]}
          workerSettingsState={workerSettingsState}
          workerAttachments={[]}
          isUpdatingWorkerSettings={false}
          isPickingAttachments={false}
          submittingApprovals={{}}
          approvalErrors={{}}
          submittingUserInputs={{}}
          userInputErrors={{}}
          onStartTurn={vi.fn()}
          onApproveRequest={vi.fn()}
          onDenyRequest={vi.fn()}
          onSubmitUserInput={vi.fn()}
          onUpdateWorkerSettings={vi.fn().mockResolvedValue(workerSettingsState)}
          onPickAttachments={vi.fn().mockResolvedValue([])}
          onAddAttachments={onAddAttachments}
          onAddPastedImageAttachments={onAddPastedImageAttachments}
          onRemoveAttachment={vi.fn()}
        />
      );
    });

    const input = container?.querySelector<HTMLInputElement>(".timeline-input");
    expect(input).not.toBeNull();

    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        files: [],
        items: [
          {
            kind: "file",
            getAsFile: () => pastedImage
          }
        ],
        getData: () => ""
      }
    });

    await act(async () => {
      input?.dispatchEvent(pasteEvent);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(onAddAttachments).not.toHaveBeenCalled();
    expect(onAddPastedImageAttachments).toHaveBeenCalledWith([
      {
        name: "Screenshot-2026-03-11-at-14.27.00.png",
        mimeType: "image/png",
        dataBase64: "AQID"
      }
    ]);
  });

  it("deduplicates the same pasted image exposed through files and items", async () => {
    const onAddPastedImageAttachments = vi.fn().mockResolvedValue([]);
    const pastedImage = {
      name: "Screenshot 2026-03-11 at 14.27.00.png",
      type: "image/png",
      size: 3,
      lastModified: 1,
      arrayBuffer: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3]).buffer)
    };

    await act(async () => {
      root?.render(
        <Timeline
          timelineState={timelineState}
          workspaceState={workspaceState}
          isStartingTurn={false}
          isResolvingRequests={false}
          realtimeState={realtimeState}
          voiceState="idle"
          isVoiceActive={false}
          liveTranscript={[]}
          workerSettingsState={workerSettingsState}
          workerAttachments={[]}
          isUpdatingWorkerSettings={false}
          isPickingAttachments={false}
          submittingApprovals={{}}
          approvalErrors={{}}
          submittingUserInputs={{}}
          userInputErrors={{}}
          onStartTurn={vi.fn()}
          onApproveRequest={vi.fn()}
          onDenyRequest={vi.fn()}
          onSubmitUserInput={vi.fn()}
          onUpdateWorkerSettings={vi.fn().mockResolvedValue(workerSettingsState)}
          onPickAttachments={vi.fn().mockResolvedValue([])}
          onAddAttachments={vi.fn().mockResolvedValue([])}
          onAddPastedImageAttachments={onAddPastedImageAttachments}
          onRemoveAttachment={vi.fn()}
        />
      );
    });

    const input = container?.querySelector<HTMLInputElement>(".timeline-input");
    expect(input).not.toBeNull();

    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        files: [pastedImage],
        items: [
          {
            kind: "file",
            getAsFile: () => pastedImage
          }
        ],
        getData: () => ""
      }
    });

    await act(async () => {
      input?.dispatchEvent(pasteEvent);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onAddPastedImageAttachments).toHaveBeenCalledWith([
      {
        name: "Screenshot-2026-03-11-at-14.27.00.png",
        mimeType: "image/png",
        dataBase64: "AQID"
      }
    ]);
    expect(pastedImage.arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it("renders approval requests above the composer and wires approve actions", async () => {
    const onApproveRequest = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root?.render(
        <Timeline
          timelineState={{
            ...timelineState,
            approvals: [
              {
                id: "approval-1",
                kind: "command",
                title: "Run tests",
                detail: "Allow `pnpm test` in the workspace.",
                availableDecisions: ["accept", "decline"],
                isSubmitting: false
              }
            ]
          }}
          workspaceState={workspaceState}
          isStartingTurn={false}
          isResolvingRequests={true}
          realtimeState={realtimeState}
          voiceState="idle"
          isVoiceActive={false}
          liveTranscript={[]}
          workerSettingsState={workerSettingsState}
          workerAttachments={[]}
          isUpdatingWorkerSettings={false}
          isPickingAttachments={false}
          submittingApprovals={{}}
          approvalErrors={{}}
          submittingUserInputs={{}}
          userInputErrors={{}}
          onStartTurn={vi.fn()}
          onApproveRequest={onApproveRequest}
          onDenyRequest={vi.fn()}
          onSubmitUserInput={vi.fn()}
          onUpdateWorkerSettings={vi.fn().mockResolvedValue(workerSettingsState)}
          onPickAttachments={vi.fn().mockResolvedValue([])}
          onAddAttachments={vi.fn().mockResolvedValue([])}
          onAddPastedImageAttachments={vi.fn().mockResolvedValue([])}
          onRemoveAttachment={vi.fn()}
        />
      );
    });

    const requestStack = container?.querySelector(".timeline-request-stack");
    const composerRow = container?.querySelector(".composer-row");
    const approveButton = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Approve"
    );

    expect(container?.textContent).toContain("Run tests");
    expect(requestStack).not.toBeNull();
    expect(composerRow).not.toBeNull();
    expect(
      Boolean(
        requestStack &&
          composerRow &&
          requestStack.compareDocumentPosition(composerRow) & Node.DOCUMENT_POSITION_FOLLOWING
      )
    ).toBe(true);

    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onApproveRequest).toHaveBeenCalledWith("approval-1", "accept");
  });

  it("uses shared picker menus for worker controls", async () => {
    const onUpdateWorkerSettings = vi.fn().mockResolvedValue(workerSettingsState);

    await act(async () => {
      root?.render(
        <Timeline
          timelineState={timelineState}
          workspaceState={workspaceState}
          isStartingTurn={false}
          isResolvingRequests={false}
          realtimeState={realtimeState}
          voiceState="idle"
          isVoiceActive={false}
          liveTranscript={[]}
          workerSettingsState={workerSettingsState}
          workerAttachments={[]}
          isUpdatingWorkerSettings={false}
          isPickingAttachments={false}
          submittingApprovals={{}}
          approvalErrors={{}}
          submittingUserInputs={{}}
          userInputErrors={{}}
          onStartTurn={vi.fn()}
          onApproveRequest={vi.fn()}
          onDenyRequest={vi.fn()}
          onSubmitUserInput={vi.fn()}
          onUpdateWorkerSettings={onUpdateWorkerSettings}
          onPickAttachments={vi.fn().mockResolvedValue([])}
          onAddAttachments={vi.fn().mockResolvedValue([])}
          onAddPastedImageAttachments={vi.fn().mockResolvedValue([])}
          onRemoveAttachment={vi.fn()}
        />
      );
    });

    const modelButton = container?.querySelector(
      'button[aria-label="Worker model"]'
    ) as HTMLButtonElement | null;
    const reasoningButton = container?.querySelector(
      'button[aria-label="Reasoning effort"]'
    ) as HTMLButtonElement | null;
    const approvalButton = container?.querySelector(
      'button[aria-label="Approval policy"]'
    ) as HTMLButtonElement | null;

    expect(container?.querySelector(".timeline-model-trigger-icon")).toBeNull();
    expect(reasoningButton?.textContent).toContain("Extra high");
    expect(approvalButton?.textContent).toContain("Never");

    await act(async () => {
      modelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const fastToggle = document.body.querySelector(
      'button[aria-label="Fast mode"]'
    ) as HTMLButtonElement | null;

    expect(fastToggle).not.toBeNull();

    await act(async () => {
      fastToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onUpdateWorkerSettings).toHaveBeenCalledWith({ fastMode: true });

    await act(async () => {
      reasoningButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const mediumReasoningOption = Array.from(document.body.querySelectorAll('[role="option"]')).find(
      (option) => option.textContent?.includes("Medium")
    );

    expect(mediumReasoningOption).not.toBeUndefined();

    await act(async () => {
      mediumReasoningOption?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onUpdateWorkerSettings).toHaveBeenCalledWith({ reasoningEffort: "medium" });

    await act(async () => {
      approvalButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const onRequestOption = Array.from(document.body.querySelectorAll('[role="option"]')).find(
      (option) => option.textContent?.includes("On request")
    ) as HTMLButtonElement | undefined;

    expect(onRequestOption).not.toBeUndefined();

    await act(async () => {
      onRequestOption?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onUpdateWorkerSettings).toHaveBeenCalledWith({ approvalPolicy: "on-request" });

    await act(async () => {
      root?.render(
        <Timeline
          timelineState={timelineState}
          workspaceState={workspaceState}
          isStartingTurn={false}
          isResolvingRequests={false}
          realtimeState={realtimeState}
          voiceState="idle"
          isVoiceActive={false}
          liveTranscript={[]}
          workerSettingsState={{
            ...workerSettingsState,
            settings: {
              ...workerSettingsState.settings,
              fastMode: true
            }
          }}
          workerAttachments={[]}
          isUpdatingWorkerSettings={false}
          isPickingAttachments={false}
          submittingApprovals={{}}
          approvalErrors={{}}
          submittingUserInputs={{}}
          userInputErrors={{}}
          onStartTurn={vi.fn()}
          onApproveRequest={vi.fn()}
          onDenyRequest={vi.fn()}
          onSubmitUserInput={vi.fn()}
          onUpdateWorkerSettings={onUpdateWorkerSettings}
          onPickAttachments={vi.fn().mockResolvedValue([])}
          onAddAttachments={vi.fn().mockResolvedValue([])}
          onAddPastedImageAttachments={vi.fn().mockResolvedValue([])}
          onRemoveAttachment={vi.fn()}
        />
      );
    });

    expect(container?.querySelector(".timeline-model-trigger-icon")).not.toBeNull();

    await act(async () => {
      modelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const activeFastToggle = document.body.querySelector(
      'button[aria-label="Fast mode"]'
    ) as HTMLButtonElement | null;

    expect(activeFastToggle?.getAttribute("aria-checked")).toBe("true");
    expect(activeFastToggle?.classList.contains("timeline-model-fast-toggle-active")).toBe(true);
  });
});
