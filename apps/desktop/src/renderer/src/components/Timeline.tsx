import { useEffect, useRef, useState, type KeyboardEventHandler } from "react";
import type {
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
import { presentTimelineEvent } from "../timeline-presenter";

interface TimelineProps {
  timelineState: TimelineState;
  workspaceState: WorkspaceState;
  isStartingTurn: boolean;
  isResolvingRequests: boolean;
  realtimeState: RealtimeState;
  voiceState: VoiceState;
  isVoiceActive: boolean;
  liveTranscript: RealtimeTranscriptEntry[];
  workerSettingsState: WorkerSettingsState;
  workerAttachments: TurnStartRequest["attachments"];
  isUpdatingWorkerSettings: boolean;
  isPickingAttachments: boolean;
  onStartTurn: (request: TurnStartRequest) => void | Promise<void>;
  onUpdateWorkerSettings: (
    patch: Partial<WorkerExecutionSettings>
  ) => Promise<WorkerSettingsState>;
  onPickAttachments: () => Promise<TurnStartRequest["attachments"]>;
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

const voiceStripLabel = (
  realtimeState: RealtimeState,
  voiceState: VoiceState,
  isVoiceActive: boolean
) => {
  if (realtimeState.error) {
    return realtimeState.error;
  }

  if (realtimeState.status === "connecting") {
    return "Voice connecting";
  }

  if (realtimeState.status === "live" && voiceState === "working") {
    return "Assistant speaking";
  }

  if (realtimeState.status === "live" && isVoiceActive) {
    return "Listening";
  }

  if (realtimeState.status === "live") {
    return "Voice ready";
  }

  return "Voice idle";
};

const buildReasoningOptions = (
  selectedEffort: WorkerReasoningEffort,
  supportedEfforts: WorkerReasoningEffort[]
) => {
  const allowed = new Set(supportedEfforts.length > 0 ? supportedEfforts : [selectedEffort]);
  allowed.add(selectedEffort);
  return REASONING_ORDER.filter((value) => allowed.has(value));
};

export function Timeline({
  timelineState,
  workspaceState,
  isStartingTurn,
  isResolvingRequests,
  realtimeState,
  voiceState,
  isVoiceActive,
  liveTranscript,
  workerSettingsState,
  workerAttachments,
  isUpdatingWorkerSettings,
  isPickingAttachments,
  onStartTurn,
  onUpdateWorkerSettings,
  onPickAttachments,
  onRemoveAttachment
}: TimelineProps) {
  const [draft, setDraft] = useState("");
  const currentProject = workspaceState.projects.find((project) => project.isCurrent) ?? null;
  const hasWorkspace = Boolean(currentProject);
  const statusLabel = isResolvingRequests
    ? "Waiting on your decision"
    : timelineState.isRunning
      ? timelineState.statusLabel ?? "turn running"
      : timelineState.statusLabel ?? (hasWorkspace ? "idle" : "repo required");
  const planCount = timelineState.planSteps?.length ?? 0;
  const approvalCount = timelineState.approvals?.length ?? 0;
  const userInputCount = timelineState.userInputs?.length ?? 0;
  const hasDiff = Boolean(timelineState.diff?.trim());
  const hasPendingHumanGate = approvalCount > 0 || userInputCount > 0;
  const hasLiveVoice = isVoiceActive || realtimeState.status !== "idle" || liveTranscript.length > 0;
  const visibleTranscript = liveTranscript.slice(-4).reverse();
  const latestTranscript = visibleTranscript[0] ?? null;
  const orderedEvents = timelineState.events;
  const isWorkingLogMode = timelineState.isRunning || isResolvingRequests;
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
  const reasoningOptions = buildReasoningOptions(
    workerSettingsState.settings.reasoningEffort,
    selectedModel?.supportedReasoningEfforts ?? []
  );
  const autoModelLabel = defaultModel ? `Auto · ${defaultModel.label}` : "Auto model";
  const attachmentNote =
    workerAttachments.some((attachment) => attachment.kind === "image") &&
    selectedModel &&
    !selectedModel.supportsImageInput
      ? "Images will be sent as file refs on this model."
      : null;

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

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    if (shouldSubmitComposerKey(event)) {
      event.preventDefault();
      void handleSubmit();
    }
  };

  useEffect(() => {
    if (!streamRef.current) {
      return;
    }

    streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [orderedEvents, latestTranscript, timelineState.isRunning, timelineState.threadId]);

  return (
    <section className="timeline panel stagger-2">
      <header className="pane-header">
        <div>
          <h2>{hasWorkspace ? currentProject?.name : "Open a workspace"}</h2>
        </div>
        <div
          className={`status-pill ${
            timelineState.isRunning || isResolvingRequests ? "status-pill-live" : ""
          }`}
        >
          {statusLabel}
        </div>
      </header>

      {hasWorkspace && (planCount > 0 || hasDiff || hasPendingHumanGate || hasLiveVoice) ? (
        <div className="timeline-utility-strip">
          {planCount > 0 ? <span className="timeline-utility-pill">plan {planCount}</span> : null}
          {hasDiff ? (
            <span className="timeline-utility-pill timeline-utility-pill-warm">diff ready</span>
          ) : null}
          {approvalCount > 0 ? (
            <span className="timeline-utility-pill timeline-utility-pill-alert">
              approvals {approvalCount}
            </span>
          ) : null}
          {userInputCount > 0 ? (
            <span className="timeline-utility-pill timeline-utility-pill-olive">
              clarify {userInputCount}
            </span>
          ) : null}
          {hasLiveVoice ? (
            <span className="timeline-utility-pill timeline-utility-pill-voice">
              {voiceStripLabel(realtimeState, voiceState, isVoiceActive)}
            </span>
          ) : null}
        </div>
      ) : null}

      {hasWorkspace && latestTranscript ? (
        <div className="timeline-voice-ribbon">
          <span className="timeline-voice-ribbon-badge">
            {latestTranscript.speaker}
            {latestTranscript.status === "partial" ? " · live" : ""}
          </span>
          <p>{latestTranscript.text}</p>
        </div>
      ) : null}

      {hasWorkspace ? (
        orderedEvents.length > 0 ? (
          <div
            ref={streamRef}
            className={`timeline-stream timeline-stream-log ${
              isWorkingLogMode ? "timeline-stream-log-active" : ""
            }`}
          >
            {orderedEvents.map((event) => {
              const presentation = presentTimelineEvent(event, isWorkingLogMode);

              if (presentation.variant === "activity") {
                return (
                  <div
                    key={event.id}
                    className={`timeline-activity-item timeline-activity-item-${presentation.tone}`}
                  >
                    {presentation.badge ? (
                      <span className="timeline-activity-badge">{presentation.badge}</span>
                    ) : null}
                    <p
                      className={
                        presentation.monospace
                          ? "timeline-activity-copy timeline-activity-copy-code"
                          : "timeline-activity-copy"
                      }
                    >
                      {presentation.title}
                    </p>
                    {presentation.metaLabel ? (
                      <span className="timeline-activity-meta">{presentation.metaLabel}</span>
                    ) : null}
                  </div>
                );
              }

              return (
                <article key={event.id} className={`timeline-message timeline-message-${presentation.tone}`}>
                  <div className="timeline-message-head">
                    {presentation.badge ? (
                      <span className="timeline-message-badge">{presentation.badge}</span>
                    ) : null}
                    {presentation.metaLabel ? (
                      <span className="timeline-message-meta">{presentation.metaLabel}</span>
                    ) : null}
                  </div>
                  <p className="timeline-message-copy">{presentation.title}</p>
                  {presentation.body ? <pre className="timeline-message-output">{presentation.body}</pre> : null}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="timeline-empty-state">
            <span className="panel-eyebrow">Thread</span>
            <p>No turns yet.</p>
          </div>
        )
      ) : (
        <div className="timeline-empty-state timeline-empty-state-muted">
          <span className="panel-eyebrow">Workspace</span>
          <p>Open a repo.</p>
        </div>
      )}

      <div className={`timeline-composer ${!hasWorkspace ? "timeline-composer-disabled" : ""}`}>
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

        <div className="composer-row">
          <textarea
            className="timeline-input"
            placeholder={hasWorkspace ? "Ask Codex" : "Open a repo first"}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!hasWorkspace || isStartingTurn}
            rows={2}
          />
          <button
            type="button"
            className="timeline-submit"
            onClick={() => void handleSubmit()}
            disabled={!hasWorkspace || isStartingTurn || draft.trim().length === 0}
          >
            {isStartingTurn ? "Starting…" : "Send"}
          </button>
        </div>

        <div className="timeline-worker-controls">
          <button
            type="button"
            className="timeline-worker-button"
            onClick={() => void onPickAttachments()}
            disabled={!hasWorkspace || isStartingTurn || isPickingAttachments}
          >
            {isPickingAttachments
              ? "Adding…"
              : workerAttachments.length > 0
                ? `Attach ${workerAttachments.length}`
                : "Attach"}
          </button>

          <label className="timeline-worker-select-wrap">
            <select
              className="timeline-worker-select"
              value={workerSettingsState.settings.model ?? ""}
              onChange={(event) =>
                void onUpdateWorkerSettings({
                  model: event.target.value || null
                })
              }
              disabled={!hasWorkspace || isUpdatingWorkerSettings}
            >
              <option value="">{autoModelLabel}</option>
              {workerSettingsState.models.map((model) => (
                <option key={model.id} value={model.model}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>

          <label className="timeline-worker-select-wrap timeline-worker-select-wrap-narrow">
            <select
              className="timeline-worker-select"
              value={workerSettingsState.settings.reasoningEffort}
              onChange={(event) =>
                void onUpdateWorkerSettings({
                  reasoningEffort: event.target.value as WorkerReasoningEffort
                })
              }
              disabled={!hasWorkspace || isUpdatingWorkerSettings}
            >
              {reasoningOptions.map((effort) => (
                <option key={effort} value={effort}>
                  {REASONING_LABELS[effort]}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className={`timeline-worker-toggle ${
              workerSettingsState.settings.fastMode ? "timeline-worker-toggle-active" : ""
            }`}
            onClick={() =>
              void onUpdateWorkerSettings({
                fastMode: !workerSettingsState.settings.fastMode
              })
            }
            disabled={!hasWorkspace || isUpdatingWorkerSettings || isStartingTurn}
          >
            Fast
          </button>

          <label className="timeline-worker-select-wrap timeline-worker-select-wrap-approval">
            <select
              className="timeline-worker-select"
              value={workerSettingsState.settings.approvalPolicy}
              onChange={(event) =>
                void onUpdateWorkerSettings({
                  approvalPolicy: event.target.value as WorkerApprovalPolicy
                })
              }
              disabled={!hasWorkspace || isUpdatingWorkerSettings}
            >
              {APPROVAL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {attachmentNote ? <p className="timeline-worker-note">{attachmentNote}</p> : null}
      </div>
    </section>
  );
}
