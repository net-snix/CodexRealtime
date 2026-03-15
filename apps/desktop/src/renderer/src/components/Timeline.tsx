import {
  useCallback,
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEventHandler,
  type KeyboardEventHandler
} from "react";
import type { EditorId } from "@codex-realtime/contracts";
import { createPortal } from "react-dom";
import type {
  ApprovalDecision,
  PastedImageAttachment,
  RealtimeState,
  RealtimeTranscriptEntry,
  TimelineState,
  TurnStartRequest,
  VoiceState,
  WorkerApprovalPolicy,
  WorkerExecutionSettings,
  WorkerReasoningEffort,
  WorkerSettingsState,
  WorkspaceState
} from "@shared";
import { shouldSubmitComposerKey } from "../composer-shortcuts";
import {
  hasPastedAttachmentCandidates,
  readPastedAttachments
} from "../pasted-attachments";
import { buildPresentedTimeline } from "../timeline-event-stream";
import { useThinkingLabel } from "../timeline-working-status";
import { TimelineEventStream } from "./TimelineEventStream";
import { TimelineOpenInPicker } from "./TimelineOpenInPicker";
import { TimelineRequests } from "./TimelineRequests";

type PaneKey = "plan" | "diff";

interface TimelineProps {
  timelineState: TimelineState;
  workspaceState: WorkspaceState;
  isStartingTurn: boolean;
  isOpeningWorkspace?: boolean;
  activePane?: PaneKey;
  isRightPaneOpen?: boolean;
  availableEditors?: readonly EditorId[];
  isResolvingRequests: boolean;
  realtimeState: RealtimeState;
  voiceState: VoiceState;
  isVoiceActive: boolean;
  liveTranscript: RealtimeTranscriptEntry[];
  workerSettingsState: WorkerSettingsState;
  workerAttachments: TurnStartRequest["attachments"];
  isUpdatingWorkerSettings: boolean;
  isPickingAttachments: boolean;
  submittingApprovals: Record<string, ApprovalDecision>;
  approvalErrors: Record<string, string>;
  submittingUserInputs: Record<string, boolean>;
  userInputErrors: Record<string, string>;
  onStartTurn: (request: TurnStartRequest) => void | Promise<void>;
  onOpenWorkspace?: () => void | Promise<void>;
  onToggleRightPane?: () => void;
  onOpenPane?: (pane: PaneKey) => void;
  onApproveRequest: (id: string, decision?: ApprovalDecision) => void | Promise<void>;
  onDenyRequest: (id: string) => void | Promise<void>;
  onSubmitUserInput: (
    id: string,
    answers: Record<string, string | string[]>
  ) => void | Promise<void>;
  onUpdateWorkerSettings: (
    patch: Partial<WorkerExecutionSettings>
  ) => Promise<WorkerSettingsState>;
  onPickAttachments: () => Promise<TurnStartRequest["attachments"]>;
  onAddAttachments: (paths: string[]) => Promise<TurnStartRequest["attachments"]>;
  onAddPastedImageAttachments: (
    images: PastedImageAttachment[]
  ) => Promise<TurnStartRequest["attachments"]>;
  onRemoveAttachment: (attachmentId: string) => void;
}

const REASONING_ORDER: WorkerReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh"
];

const REASONING_LABELS: Record<WorkerReasoningEffort, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high"
};

const APPROVAL_OPTIONS: Array<{ value: WorkerApprovalPolicy; label: string }> = [
  { value: "untrusted", label: "Untrusted" },
  { value: "on-failure", label: "On failure" },
  { value: "on-request", label: "On request" },
  { value: "never", label: "Never" }
];

type PickerMenuKind = "model" | "reasoning" | "approval";

const PICKER_MENU_WIDTH = 248;
const PICKER_MENU_GUTTER = 12;

const buildReasoningOptions = (
  selectedEffort: WorkerReasoningEffort,
  supportedEfforts: WorkerReasoningEffort[]
) => {
  const allowed = new Set(supportedEfforts.length > 0 ? supportedEfforts : [selectedEffort]);
  allowed.add(selectedEffort);
  return REASONING_ORDER.filter((value) => allowed.has(value));
};

function SendArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="timeline-submit-icon">
      <path
        d="M8 12V4.25M4.75 7.5 8 4.25 11.25 7.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function AttachPlusIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="timeline-worker-icon">
      <path
        d="M8 3.5v9M3.5 8h9"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ModelSparkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="timeline-worker-icon">
      <path
        d="M8.85 1.9 3.8 8.25h3.08L6.15 14.1l6.05-7.11H9.08l-.23-5.09Z"
        fill="currentColor"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="timeline-model-option-check">
      <path
        d="m3.5 8.25 2.5 2.5 6-6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="timeline-model-trigger-caret">
      <path
        d="m4.5 6.25 3.5 3.5 3.5-3.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function PaneToggleIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="timeline-pane-toggle-icon">
      <rect
        x="2.5"
        y="3"
        width="11"
        height="10"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d={isOpen ? "M9.25 3.75v8.5" : "M6.75 3.75v8.5"}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

export function Timeline({
  timelineState,
  workspaceState,
  isStartingTurn,
  isOpeningWorkspace = false,
  activePane = "plan",
  isRightPaneOpen = true,
  availableEditors = [],
  isResolvingRequests,
  realtimeState,
  isVoiceActive,
  liveTranscript,
  workerSettingsState,
  workerAttachments,
  isUpdatingWorkerSettings,
  isPickingAttachments,
  submittingApprovals,
  approvalErrors,
  submittingUserInputs,
  userInputErrors,
  onStartTurn,
  onOpenWorkspace = () => undefined,
  onToggleRightPane = () => undefined,
  onOpenPane = () => undefined,
  onApproveRequest,
  onDenyRequest,
  onSubmitUserInput,
  onUpdateWorkerSettings,
  onPickAttachments,
  onAddAttachments,
  onAddPastedImageAttachments,
  onRemoveAttachment
}: TimelineProps) {
  const [draft, setDraft] = useState("");
  const [openPicker, setOpenPicker] = useState<PickerMenuKind | null>(null);
  const currentProject = workspaceState.projects.find((project) => project.isCurrent) ?? null;
  const hasWorkspace = Boolean(currentProject);
  const visiblePlan = timelineState.activePlan ?? timelineState.latestProposedPlan;
  const hasPlan = Boolean(visiblePlan);
  const planCount = visiblePlan?.steps.length ?? 0;
  const approvalCount = timelineState.approvals?.length ?? 0;
  const userInputCount = timelineState.userInputs?.length ?? 0;
  const hasDiff = Boolean(timelineState.activeDiffPreview) || timelineState.turnDiffs.length > 0;
  const orderedEntries = timelineState.entries;
  const isWorkingLogMode =
    timelineState.isRunning ||
    isResolvingRequests ||
    timelineState.runState.phase === "starting";
  const thinkingLabel = useThinkingLabel(timelineState.isRunning && !isResolvingRequests);
  const presentedTimeline = useMemo(
    () => buildPresentedTimeline(orderedEntries, isWorkingLogMode),
    [orderedEntries, isWorkingLogMode]
  );
  const { latestWorkingStatus, currentWorkingLabel } = presentedTimeline;
  const activeWorkingLabel = isResolvingRequests
    ? "Waiting"
    : currentWorkingLabel ?? timelineState.runState.label ?? (thinkingLabel || "Thinking");
  const statusItems = useMemo(() => {
    const items: string[] = [];

    if (approvalCount > 0) {
      items.push(`${approvalCount} approval${approvalCount === 1 ? "" : "s"} pending`);
    }

    if (userInputCount > 0) {
      items.push(`${userInputCount} answer${userInputCount === 1 ? "" : "s"} needed`);
    }

    if (isWorkingLogMode) {
      items.push(
        isResolvingRequests ? "Needs your decision to continue" : latestWorkingStatus ?? "Working"
      );
    } else if (realtimeState.error) {
      items.push("Voice unavailable");
    } else if (realtimeState.status === "connecting") {
      items.push("Voice connecting");
    } else if (isVoiceActive || liveTranscript.length > 0) {
      items.push("Voice live");
    }

    return items;
  }, [
    approvalCount,
    isResolvingRequests,
    isVoiceActive,
    isWorkingLogMode,
    latestWorkingStatus,
    liveTranscript.length,
    realtimeState.error,
    realtimeState.status,
    userInputCount
  ]);
  const inspectorButtons = (
    [
      {
        key: "plan" as const,
        label: "Plan",
        badge: hasPlan ? (planCount > 0 ? String(planCount) : "•") : null
      },
      {
        key: "diff" as const,
        label: "Diff",
        badge: hasDiff ? String(Math.max(timelineState.turnDiffs.length, 1)) : null
      }
    ] satisfies Array<{ key: PaneKey; label: string; badge: string | null }>
  ).filter((item) => (item.key === "plan" ? hasPlan : hasDiff));
  const streamRef = useRef<HTMLDivElement | null>(null);
  const defaultModel =
    workerSettingsState.models.find((model) => model.isDefault) ??
    workerSettingsState.models[0] ??
    null;
  const selectedModel =
    workerSettingsState.models.find(
      (model) => model.model === workerSettingsState.settings.model
    ) ??
    defaultModel;
  const planModeOption = workerSettingsState.collaborationModes.find(
    (mode) => mode.mode === "plan"
  );
  const showPlanModeToggle = Boolean(planModeOption);
  const reasoningOptions = buildReasoningOptions(
    workerSettingsState.settings.reasoningEffort,
    selectedModel?.supportedReasoningEfforts ?? []
  );
  const autoModelLabel = defaultModel ? `Auto · ${defaultModel.label}` : "Auto model";
  const selectedModelLabel = workerSettingsState.settings.model
    ? selectedModel?.label ?? workerSettingsState.settings.model
    : autoModelLabel;
  const attachmentNote =
    workerAttachments.some((attachment) => attachment.kind === "image") &&
    selectedModel &&
    !selectedModel.supportsImageInput
      ? "Images will be sent as file refs on this model."
      : null;
  const menuRef = useRef<HTMLDivElement | null>(null);
  const modelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const reasoningTriggerRef = useRef<HTMLButtonElement | null>(null);
  const approvalTriggerRef = useRef<HTMLButtonElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const modelOptions = [
    {
      key: "__auto__",
      value: "",
      label: autoModelLabel
    },
    ...workerSettingsState.models.map((model) => ({
      key: model.id,
      value: model.model,
      label: model.label
    }))
  ];
  const reasoningMenuOptions = reasoningOptions.map((effort) => ({
    key: effort,
    value: effort,
    label: REASONING_LABELS[effort]
  }));
  const approvalMenuOptions = APPROVAL_OPTIONS.map((option) => ({
    key: option.value,
    value: option.value,
    label: option.label
  }));
  const selectedReasoningLabel = REASONING_LABELS[workerSettingsState.settings.reasoningEffort];
  const selectedApprovalLabel =
    APPROVAL_OPTIONS.find((option) => option.value === workerSettingsState.settings.approvalPolicy)
      ?.label ?? "Never";
  const composerPlaceholder = hasWorkspace
    ? "Ask anything, @tag files/folders, or type / for quick command hints"
    : "Open a repo first";
  const handleSubmit = async () => {
    const prompt = draft.trim();

    if (!prompt || !hasWorkspace) {
      return;
    }

    await onStartTurn({
      prompt,
      attachments: workerAttachments
    });
    setDraft("");
  };

  const getPickerTrigger = (kind: PickerMenuKind) => {
    if (kind === "model") {
      return modelTriggerRef.current;
    }

    if (kind === "reasoning") {
      return reasoningTriggerRef.current;
    }

    return approvalTriggerRef.current;
  };

  const syncPickerMenuPosition = useCallback((kind: PickerMenuKind) => {
    const trigger =
      kind === "model"
        ? modelTriggerRef.current
        : kind === "reasoning"
          ? reasoningTriggerRef.current
          : approvalTriggerRef.current;

    if (!trigger) {
      setMenuStyle(null);
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const left = Math.max(
      PICKER_MENU_GUTTER,
      Math.min(rect.left, window.innerWidth - PICKER_MENU_WIDTH - PICKER_MENU_GUTTER)
    );
    const shouldOpenUpward = rect.top > window.innerHeight * 0.5;

    setMenuStyle(
      shouldOpenUpward
        ? {
            left,
            bottom: Math.max(PICKER_MENU_GUTTER, window.innerHeight - rect.top + 8),
            width: PICKER_MENU_WIDTH,
            transformOrigin: "bottom left"
          }
        : {
            left,
            top: Math.max(PICKER_MENU_GUTTER, rect.bottom + 8),
            width: PICKER_MENU_WIDTH,
            transformOrigin: "top left"
          }
    );
  }, []);

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    if (shouldSubmitComposerKey(event)) {
      event.preventDefault();
      void handleSubmit();
    }
  };

  const handlePaste: ClipboardEventHandler<HTMLTextAreaElement> = (event) => {
    if (!hasWorkspace || isStartingTurn) {
      return;
    }

    const clipboardData = event.clipboardData;

    if (!hasPastedAttachmentCandidates(clipboardData)) {
      return;
    }

    event.preventDefault();
    void readPastedAttachments(clipboardData)
      .then(async ({ paths, images }) => {
        await Promise.all([
          paths.length > 0 ? onAddAttachments(paths) : Promise.resolve([]),
          images.length > 0
            ? onAddPastedImageAttachments(images)
            : Promise.resolve([])
        ]);
      })
      .catch((error) => {
        console.error("Failed to add pasted attachments", error);
      });
  };

  useEffect(() => {
    const textarea = composerInputRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 84), 160);
    textarea.style.height = `${nextHeight}px`;
  }, [draft, hasWorkspace]);

  useEffect(() => {
    if (!openPicker) {
      return;
    }

    syncPickerMenuPosition(openPicker);

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (menuRef.current?.contains(target) || getPickerTrigger(openPicker)?.contains(target)) {
        return;
      }

      setOpenPicker(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      const trigger = getPickerTrigger(openPicker);
      setOpenPicker(null);
      trigger?.focus();
    };

    const handleViewportChange = () => {
      syncPickerMenuPosition(openPicker);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [openPicker, syncPickerMenuPosition]);

  useEffect(() => {
    if (!hasWorkspace || isStartingTurn) {
      setOpenPicker(null);
      setMenuStyle(null);
    }
  }, [hasWorkspace, isStartingTurn]);

  useEffect(() => {
    if (!streamRef.current) {
      return;
    }

    streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [orderedEntries, timelineState.isRunning, timelineState.threadId]);

  const togglePicker = (kind: PickerMenuKind) => {
    setOpenPicker((current) => {
      if (current === kind) {
        return null;
      }

      syncPickerMenuPosition(kind);
      return kind;
    });
  };

  const closePicker = () => {
    setOpenPicker(null);
  };

  return (
    <section className="timeline panel stagger-2">
      <div className="timeline-window-strip" aria-hidden="true" />

      <header className="pane-header">
        <div>
          <h2>{hasWorkspace ? currentProject?.name : "Open a workspace"}</h2>
        </div>
        <div className="timeline-header-actions">
          {hasWorkspace ? (
            <TimelineOpenInPicker
              availableEditors={availableEditors}
              openInCwd={currentProject?.path ?? null}
            />
          ) : null}
          {inspectorButtons.length > 0 ? (
            <div className="timeline-inspector-group" role="tablist" aria-label="Inspector targets">
              {inspectorButtons.map((button) => (
                <button
                  key={button.key}
                  type="button"
                  role="tab"
                  aria-selected={isRightPaneOpen && activePane === button.key}
                  className={`timeline-inspector-button${
                    isRightPaneOpen && activePane === button.key
                      ? " timeline-inspector-button-active"
                      : ""
                  }`}
                  onClick={() => onOpenPane(button.key)}
                >
                  <span>{button.label}</span>
                  {button.badge ? (
                    <span className="timeline-inspector-badge">{button.badge}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className={`timeline-pane-toggle${isRightPaneOpen ? " timeline-pane-toggle-active" : ""}`}
            aria-label={isRightPaneOpen ? "Hide right pane" : "Show right pane"}
            aria-pressed={isRightPaneOpen}
            onClick={onToggleRightPane}
            title={isRightPaneOpen ? "Hide right pane" : "Show right pane"}
          >
            <PaneToggleIcon isOpen={isRightPaneOpen} />
            <span>{isRightPaneOpen ? "Hide" : "Panel"}</span>
          </button>
        </div>
      </header>

      {hasWorkspace && statusItems.length > 0 ? (
        <p className="timeline-context-line">{statusItems.join(" · ")}</p>
      ) : null}

      {hasWorkspace ? (
        orderedEntries.length > 0 ? (
          <TimelineEventStream
            entries={orderedEntries}
            presentedTimeline={presentedTimeline}
            isWorkingLogMode={isWorkingLogMode}
            isRunning={timelineState.isRunning}
            isResolvingRequests={isResolvingRequests}
            activeWorkingLabel={activeWorkingLabel}
            activeWorkStartedAt={timelineState.activeWorkStartedAt}
            streamRef={streamRef}
            cwd={currentProject?.path}
            availableEditors={availableEditors}
          />
        ) : (
          <div className="timeline-empty-state timeline-empty-state-prompt">
            <div className="timeline-empty-state-inner">
              <p>Send a message to start working</p>
            </div>
          </div>
        )
      ) : (
        <div className="timeline-empty-state timeline-empty-state-callout">
          <div className="timeline-empty-state-inner">
            <p>Open a repo to get started</p>
            <button
              type="button"
              className="timeline-empty-action"
              onClick={() => void onOpenWorkspace()}
              disabled={isOpeningWorkspace}
            >
              <span>{isOpeningWorkspace ? "Opening repo..." : "Add repo"}</span>
            </button>
          </div>
        </div>
      )}

      <div className={`timeline-composer ${!hasWorkspace ? "timeline-composer-disabled" : ""}`}>
        <TimelineRequests
          approvals={timelineState.approvals}
          userInputs={timelineState.userInputs}
          submittingApprovals={submittingApprovals}
          approvalErrors={approvalErrors}
          submittingUserInputs={submittingUserInputs}
          userInputErrors={userInputErrors}
          onApproveRequest={onApproveRequest}
          onDenyRequest={onDenyRequest}
          onSubmitUserInput={onSubmitUserInput}
        />

        <div className="timeline-compose-card">
          {workerAttachments.length > 0 ? (
            <div className="timeline-attachment-row">
              {workerAttachments.map((attachment) => (
                <div key={attachment.id} className="timeline-attachment-chip">
                  <span className="timeline-attachment-kind">{attachment.kind}</span>
                  <span className="timeline-attachment-name" title={attachment.path}>
                    {attachment.name}
                  </span>
                  <button
                    type="button"
                    className="timeline-attachment-remove"
                    onClick={() => onRemoveAttachment(attachment.id)}
                    disabled={isStartingTurn}
                    aria-label={`Remove ${attachment.name}`}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="timeline-input-shell">
            <textarea
              ref={composerInputRef}
              className="timeline-input"
              placeholder={composerPlaceholder}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              disabled={!hasWorkspace || isStartingTurn}
              autoComplete="off"
              rows={1}
              spellCheck={false}
            />
          </div>

          <div className="composer-row">
            <div className="timeline-compose-tools">
              <button
                type="button"
                className="timeline-composer-attach"
                onClick={() => void onPickAttachments()}
                disabled={!hasWorkspace || isStartingTurn || isPickingAttachments}
                aria-label={
                  isPickingAttachments
                    ? "Adding files"
                    : workerAttachments.length > 0
                      ? `Attach files (${workerAttachments.length} selected)`
                      : "Attach files"
                }
                title={
                  isPickingAttachments
                    ? "Adding files"
                    : workerAttachments.length > 0
                      ? `Attach files (${workerAttachments.length})`
                      : "Attach files"
                }
              >
                <AttachPlusIcon />
              </button>

              <div className="timeline-model-picker">
                <button
                  ref={modelTriggerRef}
                  type="button"
                  className={`timeline-model-trigger${openPicker === "model" ? " timeline-model-trigger-open" : ""}`}
                  aria-label="Worker model"
                  aria-expanded={openPicker === "model"}
                  aria-haspopup="dialog"
                  onClick={() => togglePicker("model")}
                  disabled={!hasWorkspace || isUpdatingWorkerSettings}
                >
                  {workerSettingsState.settings.fastMode ? (
                    <span className="timeline-model-trigger-icon" aria-hidden="true">
                      <ModelSparkIcon />
                    </span>
                  ) : null}
                  <span className="timeline-model-trigger-label">{selectedModelLabel}</span>
                  <ChevronDownIcon />
                </button>
              </div>

              <span className="timeline-compose-divider" aria-hidden="true" />

              <div className="timeline-model-picker timeline-model-picker-narrow">
                <button
                  ref={reasoningTriggerRef}
                  type="button"
                  className={`timeline-model-trigger${openPicker === "reasoning" ? " timeline-model-trigger-open" : ""}`}
                  aria-label="Reasoning effort"
                  aria-expanded={openPicker === "reasoning"}
                  aria-haspopup="dialog"
                  onClick={() => togglePicker("reasoning")}
                  disabled={!hasWorkspace || isUpdatingWorkerSettings}
                >
                  <span className="timeline-model-trigger-label">{selectedReasoningLabel}</span>
                  <ChevronDownIcon />
                </button>
              </div>

              {showPlanModeToggle ? (
                <>
                  <span className="timeline-compose-divider" aria-hidden="true" />

                  <button
                    type="button"
                    role="switch"
                    aria-checked={workerSettingsState.settings.collaborationMode === "plan"}
                    aria-label={`${planModeOption?.label ?? "Plan"} mode`}
                    className={`timeline-worker-toggle timeline-worker-mode-button ${
                      workerSettingsState.settings.collaborationMode === "plan"
                        ? "timeline-worker-toggle-active"
                        : ""
                    }`}
                    onClick={() =>
                      void onUpdateWorkerSettings({
                        collaborationMode:
                          workerSettingsState.settings.collaborationMode === "plan"
                            ? "default"
                            : "plan"
                      })
                    }
                    disabled={!hasWorkspace || isUpdatingWorkerSettings || isStartingTurn}
                    title={planModeOption?.name ?? "Plan"}
                  >
                    <span className="timeline-worker-toggle-label">
                      {planModeOption?.label ?? "Plan"}
                    </span>
                    <span className="timeline-worker-switch" aria-hidden="true">
                      <span className="timeline-worker-switch-thumb" />
                    </span>
                  </button>
                </>
              ) : null}

              <span className="timeline-compose-divider" aria-hidden="true" />

              <div className="timeline-model-picker timeline-model-picker-approval">
                <button
                  ref={approvalTriggerRef}
                  type="button"
                  className={`timeline-model-trigger${openPicker === "approval" ? " timeline-model-trigger-open" : ""}`}
                  aria-label="Approval policy"
                  aria-expanded={openPicker === "approval"}
                  aria-haspopup="dialog"
                  onClick={() => togglePicker("approval")}
                  disabled={!hasWorkspace || isUpdatingWorkerSettings}
                >
                  <span className="timeline-model-trigger-label">{selectedApprovalLabel}</span>
                  <ChevronDownIcon />
                </button>
              </div>
            </div>

            <div className="timeline-compose-actions">
              <button
                type="button"
                className="timeline-submit"
                onClick={() => void handleSubmit()}
                disabled={!hasWorkspace || isStartingTurn || draft.trim().length === 0}
                aria-label={isStartingTurn ? "Starting" : "Send"}
                title={isStartingTurn ? "Starting" : "Send"}
              >
                <SendArrowIcon />
              </button>
            </div>
          </div>
        </div>

        {attachmentNote ? <p className="timeline-worker-note">{attachmentNote}</p> : null}
      </div>

      {openPicker && menuStyle
        ? createPortal(
            <div
              ref={menuRef}
              className="timeline-model-menu"
              style={menuStyle}
              role="dialog"
              aria-label={
                openPicker === "model"
                  ? "Worker model menu"
                  : openPicker === "reasoning"
                    ? "Reasoning effort menu"
                    : "Approval policy menu"
              }
            >
              <div
                className="timeline-model-option-list"
                role="listbox"
                aria-label={
                  openPicker === "model"
                    ? "Worker model options"
                    : openPicker === "reasoning"
                      ? "Reasoning effort options"
                      : "Approval policy options"
                }
              >
                {(openPicker === "model"
                  ? modelOptions
                  : openPicker === "reasoning"
                    ? reasoningMenuOptions
                    : approvalMenuOptions
                ).map((option) => {
                  const isSelected =
                    openPicker === "model"
                      ? (workerSettingsState.settings.model ?? "") === option.value
                      : openPicker === "reasoning"
                        ? workerSettingsState.settings.reasoningEffort === option.value
                        : workerSettingsState.settings.approvalPolicy === option.value;

                  return (
                    <button
                      key={option.key}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`timeline-model-option${
                        isSelected ? " timeline-model-option-selected" : ""
                      }`}
                      onClick={() => {
                        if (openPicker === "model") {
                          void onUpdateWorkerSettings({
                            model: option.value || null
                          });
                        } else if (openPicker === "reasoning") {
                          void onUpdateWorkerSettings({
                            reasoningEffort: option.value as WorkerReasoningEffort
                          });
                        } else {
                          void onUpdateWorkerSettings({
                            approvalPolicy: option.value as WorkerApprovalPolicy
                          });
                        }

                        closePicker();
                      }}
                    >
                      <span>{option.label}</span>
                      {isSelected ? <CheckIcon /> : null}
                    </button>
                  );
                })}
              </div>

              {openPicker === "model" ? <div className="timeline-model-menu-divider" /> : null}

              {openPicker === "model" ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={workerSettingsState.settings.fastMode}
                  aria-label="Fast mode"
                  className={`timeline-model-fast-toggle${
                    workerSettingsState.settings.fastMode
                      ? " timeline-model-fast-toggle-active"
                      : ""
                  }`}
                  onClick={() =>
                    void onUpdateWorkerSettings({
                      fastMode: !workerSettingsState.settings.fastMode
                    })
                  }
                  disabled={!hasWorkspace || isUpdatingWorkerSettings || isStartingTurn}
                >
                  <span className="timeline-model-fast-copy">
                    <span className="timeline-model-fast-label">
                      <ModelSparkIcon />
                      Fast
                    </span>
                    <span className="timeline-model-fast-note">
                      Prefer faster worker runs. Uses 2x plan usage.
                    </span>
                  </span>
                  <span className="timeline-worker-switch" aria-hidden="true">
                    <span className="timeline-worker-switch-thumb" />
                  </span>
                </button>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </section>
  );
}
