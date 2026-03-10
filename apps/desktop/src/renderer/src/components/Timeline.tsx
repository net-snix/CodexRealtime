import { useState, type KeyboardEventHandler } from "react";
import type {
  RealtimeState,
  RealtimeTranscriptEntry,
  TimelineState,
  VoiceState,
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
  onStartTurn: (prompt: string) => void | Promise<void>;
}

const voiceHeadline = (realtimeState: RealtimeState, isVoiceActive: boolean) => {
  if (realtimeState.status === "error") {
    return "Voice error.";
  }

  if (realtimeState.status === "connecting") {
    return "Voice connecting.";
  }

  if (realtimeState.status === "live" && isVoiceActive) {
    return "Mic live.";
  }

  if (realtimeState.status === "live") {
    return "Voice ready.";
  }

  return "Voice idle.";
};

const voiceSupportCopy = (
  realtimeState: RealtimeState,
  voiceState: VoiceState,
  isVoiceActive: boolean
) => {
  if (realtimeState.error) {
    return realtimeState.error;
  }

  if (realtimeState.status === "connecting") {
    return "Connecting voice transport.";
  }

  if (realtimeState.status === "live" && voiceState === "working") {
    return "Assistant speaking.";
  }

  if (realtimeState.status === "live" && isVoiceActive) {
    return "Listening.";
  }

  if (realtimeState.status === "live") {
    return "Voice available.";
  }

  return "Text turns ready.";
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
  onStartTurn
}: TimelineProps) {
  const [draft, setDraft] = useState("");
  const hasWorkspace = Boolean(workspaceState.currentWorkspace);
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
  const voiceBadgeLabel =
    realtimeState.status === "live" && isVoiceActive ? "mic live" : realtimeState.status;
  const visibleTranscript = liveTranscript.slice(-4).reverse();

  const handleSubmit = async () => {
    const prompt = draft.trim();

    if (!prompt || !hasWorkspace) {
      return;
    }

    await onStartTurn(prompt);
    setDraft("");
  };

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <section className="timeline panel stagger-2">
      <header className="pane-header">
        <div>
          <span className="panel-eyebrow">Thread</span>
          <h2>{hasWorkspace ? workspaceState.currentWorkspace?.name : "Open a workspace"}</h2>
        </div>
        <div
          className={`status-pill ${
            timelineState.isRunning || isResolvingRequests ? "status-pill-live" : ""
          }`}
        >
          {statusLabel}
        </div>
      </header>

      <div className={`timeline-composer ${!hasWorkspace ? "timeline-composer-disabled" : ""}`}>
        <div className="composer-copy">
          <span className="panel-eyebrow">Compose</span>
          <p>
            {hasWorkspace
              ? "Ask, steer, or assign the next step."
              : "Open a repo to enable the thread."}
          </p>
        </div>
        <div className="composer-row">
          <textarea
            className="timeline-input"
            placeholder={
              hasWorkspace
                ? "What should Codex do next?"
                : "Open a repo first"
            }
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!hasWorkspace || isStartingTurn}
            rows={3}
          />
          <button
            type="button"
            className="timeline-submit"
            onClick={() => void handleSubmit()}
            disabled={!hasWorkspace || isStartingTurn || draft.trim().length === 0}
          >
            {isStartingTurn ? "Starting…" : "Run"}
          </button>
        </div>
      </div>

      {hasWorkspace && (planCount > 0 || hasDiff || approvalCount > 0 || userInputCount > 0) ? (
        <div className="timeline-briefing">
          <span className="panel-eyebrow">Live briefing</span>
          <div className="timeline-briefing-grid">
            {planCount > 0 ? (
              <div className="briefing-card">
                <strong>{planCount}</strong>
                <span>plan steps tracked</span>
              </div>
            ) : null}
            {hasDiff ? (
              <div className="briefing-card briefing-card-warm">
                <strong>Diff ready</strong>
                <span>Preview waiting in the side rail</span>
              </div>
            ) : null}
            {approvalCount > 0 ? (
              <div className="briefing-card briefing-card-alert">
                <strong>{approvalCount}</strong>
                <span>approval {approvalCount === 1 ? "request" : "requests"} pending</span>
              </div>
            ) : null}
            {userInputCount > 0 ? (
              <div className="briefing-card briefing-card-olive">
                <strong>{userInputCount}</strong>
                <span>clarification {userInputCount === 1 ? "prompt" : "prompts"} queued</span>
              </div>
            ) : null}
          </div>
          {hasPendingHumanGate ? (
            <p className="timeline-briefing-note">
              Waiting on approval or clarification.
            </p>
          ) : null}
        </div>
      ) : null}

      {hasWorkspace && hasPendingHumanGate ? (
        <div className="timeline-attention-callout">
          <span className="panel-eyebrow">Needs you</span>
          <h3>
            {approvalCount > 0 ? `${approvalCount} approval ${approvalCount === 1 ? "request" : "requests"}` : null}
            {approvalCount > 0 && userInputCount > 0 ? " and " : null}
            {userInputCount > 0
              ? `${userInputCount} clarification ${userInputCount === 1 ? "prompt" : "prompts"}`
              : null}
          </h3>
          <p>Answer in the right rail.</p>
        </div>
      ) : null}

      {hasWorkspace && hasLiveVoice ? (
        <section
          className={`voice-transcript-panel ${
            realtimeState.status === "error" ? "voice-transcript-panel-error" : ""
          }`}
        >
          <header className="voice-transcript-header">
            <div>
              <span className="panel-eyebrow">Live voice</span>
              <h3>{voiceHeadline(realtimeState, isVoiceActive)}</h3>
            </div>
            <div
              className={`status-pill ${
                realtimeState.status === "live" || realtimeState.status === "connecting"
                  ? "status-pill-live"
                  : ""
              }`}
            >
              {voiceBadgeLabel}
            </div>
          </header>
          <p className="voice-transcript-copy">
            {voiceSupportCopy(realtimeState, voiceState, isVoiceActive)}
          </p>
          {visibleTranscript.length > 0 ? (
            <div className="voice-transcript-stream">
              {visibleTranscript.map((entry) => (
                <article
                  key={entry.id}
                  className={`voice-transcript-item voice-transcript-item-${entry.speaker}`}
                >
                  <span>
                    {entry.speaker}
                    {entry.status === "partial" ? " · partial" : ""}
                  </span>
                  <p>{entry.text}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="voice-transcript-empty">
              <span className="panel-eyebrow">Transcript</span>
              <p>No live voice yet.</p>
            </div>
          )}
        </section>
      ) : null}

      {hasWorkspace ? (
        timelineState.events.length > 0 ? (
          <div className="timeline-stream">
            {timelineState.events.map((event) => (
              <article key={event.id} className={`timeline-item timeline-item-${event.kind}`}>
                <div className="timeline-meta">
                  <span>{event.kind}</span>
                  <span>{event.createdAt}</span>
                </div>
                <p>{event.text}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="timeline-empty-state">
            <span className="panel-eyebrow">Primary thread</span>
            <h3>No turns yet.</h3>
            <p>Start with a short instruction.</p>
          </div>
        )
      ) : (
        <div className="timeline-empty-state timeline-empty-state-muted">
          <span className="panel-eyebrow">Workspace needed</span>
          <h3>Open a repo.</h3>
          <p>The thread will bind here.</p>
        </div>
      )}
    </section>
  );
}
