import { useEffect, useRef, useState, type KeyboardEventHandler } from "react";
import type {
  RealtimeState,
  RealtimeTranscriptEntry,
  TimelineEvent,
  TimelineState,
  TurnStartRequest,
  VoiceState,
  WorkerApprovalPolicy,
  WorkerExecutionSettings,
  WorkerReasoningEffort,
  WorkerSettingsState,
  WorkspaceState
} from "@shared";

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

type EventPresentation = {
  badge: string;
  tone: "user" | "assistant" | "commentary" | "tool" | "system" | "plan" | "patch";
  title: string;
  body: string | null;
  monospace?: boolean;
  lowOpacity?: boolean;
};

const getEventPresentation = (event: TimelineEvent): EventPresentation => {
  if (event.kind === "user") {
    return {
      badge: "You",
      tone: "user",
      title: event.text,
      body: null
    };
  }

  if (event.kind === "assistant") {
    return {
      badge: "Codex",
      tone: "assistant",
      title: event.text,
      body: null
    };
  }

  if (event.kind === "commentary") {
    if (event.text.startsWith("Plan update:")) {
      return {
        badge: "Plan",
        tone: "plan",
        title: event.text.replace("Plan update:", "").trim(),
        body: null,
        lowOpacity: true
      };
    }

    return {
      badge: "Note",
      tone: "commentary",
      title: event.text,
      body: null,
      lowOpacity: true
    };
  }

  if (event.text.startsWith("Command:")) {
    const [commandLine, ...outputLines] = event.text.split("\n");

    return {
      badge: "Tool",
      tone: "tool",
      title: commandLine.replace("Command:", "").trim(),
      body: outputLines.join("\n").trim() || null,
      monospace: true,
      lowOpacity: true
    };
  }

  if (event.text.startsWith("File changes proposed:")) {
    return {
      badge: "Patch",
      tone: "patch",
      title: event.text.replace("File changes proposed:", "").trim() + " files changed",
      body: null,
      lowOpacity: true
    };
  }

  return {
    badge: "System",
    tone: "system",
    title: event.text,
    body: null,
    lowOpacity: true
  };
};

const getEventMetaLabel = (createdAt: string) =>
  createdAt === "Thread history" ? null : createdAt;

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
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
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
          <span className="panel-eyebrow">Thread</span>
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
          <div ref={streamRef} className="timeline-stream timeline-stream-log">
            {orderedEvents.map((event) => {
              const presentation = getEventPresentation(event);
              const metaLabel = getEventMetaLabel(event.createdAt);

              return (
                <article
                  key={event.id}
                  className={`timeline-log-item timeline-log-item-${presentation.tone} ${
                    presentation.lowOpacity ? "timeline-log-item-muted" : ""
                  }`}
                >
                  <div className="timeline-log-body">
                    <div className="timeline-log-head">
                      <span className="timeline-log-badge">{presentation.badge}</span>
                      {metaLabel ? <span className="timeline-log-time">{metaLabel}</span> : null}
                    </div>
                    <p
                      className={
                        presentation.monospace
                          ? "timeline-log-title timeline-log-title-code"
                          : "timeline-log-title"
                      }
                    >
                      {presentation.title}
                    </p>
                    {presentation.body ? (
                      <pre className="timeline-log-output">{presentation.body}</pre>
                    ) : null}
                  </div>
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
