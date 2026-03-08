import { useState, type KeyboardEventHandler } from "react";
import type { TimelineState, WorkspaceState } from "@shared";

type LiveTimelineState = TimelineState & {
  planSteps?: Array<{ step: string; status: string }>;
  diff?: string;
  approvals?: Array<{ id: string; kind: "command" | "fileChange"; title: string; detail: string }>;
  userInputs?: Array<{ id: string; title: string; questions: string[] }>;
};

interface TimelineProps {
  timelineState: LiveTimelineState;
  workspaceState: WorkspaceState;
  isStartingTurn: boolean;
  onStartTurn: (prompt: string) => void | Promise<void>;
}

export function Timeline({
  timelineState,
  workspaceState,
  isStartingTurn,
  onStartTurn
}: TimelineProps) {
  const [draft, setDraft] = useState("");
  const hasWorkspace = Boolean(workspaceState.currentWorkspace);
  const statusLabel = timelineState.isRunning
    ? timelineState.statusLabel ?? "turn running"
    : timelineState.statusLabel ?? (hasWorkspace ? "idle" : "repo required");
  const planCount = timelineState.planSteps?.length ?? 0;
  const approvalCount = timelineState.approvals?.length ?? 0;
  const userInputCount = timelineState.userInputs?.length ?? 0;
  const hasDiff = Boolean(timelineState.diff?.trim());

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
          <span className="panel-eyebrow">Conversation</span>
          <h2>{hasWorkspace ? "One assistant. One live thread." : "Thread waits on a repo."}</h2>
        </div>
        <div className={`status-pill ${timelineState.isRunning ? "status-pill-live" : ""}`}>
          {statusLabel}
        </div>
      </header>

      <div className={`timeline-composer ${!hasWorkspace ? "timeline-composer-disabled" : ""}`}>
        <div className="composer-copy">
          <span className="panel-eyebrow">Turn input</span>
          <p>
            {hasWorkspace
              ? `Current repo: ${workspaceState.currentWorkspace?.name}`
              : "Open a repo first. Then you can kick off the first text turn from here."}
          </p>
        </div>
        <div className="composer-row">
          <textarea
            className="timeline-input"
            placeholder={
              hasWorkspace
                ? "Ask a repo-aware question or give the next coding instruction..."
                : "Open a repo to enable turn input"
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
            {isStartingTurn ? "Starting…" : "Start turn"}
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
        </div>
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
            <h3>Ready. No turns yet.</h3>
            <p>Use the composer above to kick off the first repo-aware turn for this workspace.</p>
          </div>
        )
      ) : (
        <div className="timeline-empty-state timeline-empty-state-muted">
          <span className="panel-eyebrow">Workspace needed</span>
          <h3>Open a repo first.</h3>
          <p>The center pane stays read-only until a workspace is bound and its primary thread exists.</p>
        </div>
      )}
    </section>
  );
}
