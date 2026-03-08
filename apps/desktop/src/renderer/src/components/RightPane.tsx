import type { TimelineState } from "@shared";

const PANELS = {
  plan: {
    title: "Plan",
    eyebrow: "Live orchestration",
  },
  diff: {
    title: "Diff",
    eyebrow: "Change preview",
  },
  commands: {
    title: "Commands",
    eyebrow: "Operator feed",
  },
  approvals: {
    title: "Approvals",
    eyebrow: "Human gate",
  },
  errors: {
    title: "Errors",
    eyebrow: "Debug rail",
  },
} as const;

type PaneKey = keyof typeof PANELS;
type LiveTimelineState = TimelineState & {
  planSteps?: Array<{ step: string; status: string }>;
  diff?: string;
  approvals?: Array<{ id: string; kind: "command" | "fileChange"; title: string; detail: string }>;
  userInputs?: Array<{ id: string; title: string; questions: string[] }>;
};

interface RightPaneProps {
  activePane: PaneKey;
  onSelect: (pane: PaneKey) => void;
  timelineState: LiveTimelineState;
}

const PLAN_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed"
};

const truncateDiff = (diff: string) => {
  const trimmed = diff.trim();

  if (trimmed.length <= 1800) {
    return trimmed;
  }

  return `${trimmed.slice(0, 1800)}\n\n…diff preview truncated`;
};

export function RightPane({ activePane, onSelect, timelineState }: RightPaneProps) {
  const pane = PANELS[activePane];
  const planSteps = timelineState.planSteps ?? [];
  const approvals = timelineState.approvals ?? [];
  const userInputs = timelineState.userInputs ?? [];
  const diff = timelineState.diff ?? "";
  const pendingApprovals = approvals.length;
  const pendingPrompts = userInputs.length;
  const paneBadges: Partial<Record<PaneKey, number>> = {
    plan: planSteps.length,
    approvals: pendingApprovals + pendingPrompts
  };

  const renderPaneBody = () => {
    if (activePane === "plan") {
      return planSteps.length > 0 ? (
        <div className="dossier-stack">
          {planSteps.map((step, index) => (
            <article key={`${step.step}-${index}`} className="dossier-card">
              <div className="dossier-row">
                <span className={`dossier-status dossier-status-${step.status}`}>
                  {PLAN_STATUS_LABELS[step.status] ?? step.status}
                </span>
                <span className="dossier-index">Step {index + 1}</span>
              </div>
              <p>{step.step}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="pane-empty-state">
          <h3>No plan yet</h3>
          <p>As soon as Codex exposes plan updates, they stack here in order.</p>
        </div>
      );
    }

    if (activePane === "diff") {
      return diff.trim() ? (
        <div className="dossier-stack">
          <div className="diff-preview-header">
            <span className="status-pill status-pill-live">Live preview</span>
            <span className="diff-preview-meta">{diff.split("\n").length} lines surfaced</span>
          </div>
          <pre className="diff-preview">{truncateDiff(diff)}</pre>
        </div>
      ) : (
        <div className="pane-empty-state">
          <h3>No diff yet</h3>
          <p>File changes will show up here before we add approval actions.</p>
        </div>
      );
    }

    if (activePane === "commands") {
      return (
        <div className="dossier-stack">
          <article className="dossier-card">
            <div className="dossier-row">
              <span className="dossier-index">Thread</span>
              <span className="session-meta">{timelineState.threadId ?? "unbound"}</span>
            </div>
            <p>{timelineState.statusLabel ?? "No live command activity yet."}</p>
          </article>
          <article className="dossier-card">
            <div className="dossier-row">
              <span className="dossier-index">Stream</span>
              <span className="session-meta">{timelineState.events.length} events</span>
            </div>
            <p>Command-level streaming lands next. For now this rail shows thread pulse and event volume.</p>
          </article>
        </div>
      );
    }

    if (activePane === "approvals") {
      return pendingApprovals > 0 || pendingPrompts > 0 ? (
        <div className="dossier-stack">
          {approvals.map((approval) => (
            <article key={approval.id} className="dossier-card dossier-card-alert">
              <div className="dossier-row">
                <span className="dossier-status dossier-status-alert">
                  {approval.kind === "command" ? "Command approval" : "File approval"}
                </span>
                <span className="dossier-index">Pending</span>
              </div>
              <h3>{approval.title}</h3>
              <p>{approval.detail}</p>
            </article>
          ))}
          {userInputs.map((prompt) => (
            <article key={prompt.id} className="dossier-card dossier-card-olive">
              <div className="dossier-row">
                <span className="dossier-status dossier-status-olive">Request user input</span>
                <span className="dossier-index">{prompt.questions.length} questions</span>
              </div>
              <h3>{prompt.title}</h3>
              <ul className="question-list">
                {prompt.questions.map((question, index) => (
                  <li key={`${prompt.id}-${index}`}>{question}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : (
        <div className="pane-empty-state">
          <h3>No blockers</h3>
          <p>Approvals and clarification prompts will queue here as read-only cards.</p>
        </div>
      );
    }

    return (
      <div className="pane-empty-state">
        <h3>Quiet rail</h3>
        <p>Developer logs stay muted here until main starts sending dedicated error events.</p>
      </div>
    );
  };

  return (
    <aside className="right-pane panel stagger-3">
      <div className="pane-tabs" role="tablist" aria-label="Utility panels">
        {(Object.keys(PANELS) as PaneKey[]).map((key) => (
          <button
            key={key}
            type="button"
            className={key === activePane ? "pane-tab active" : "pane-tab"}
            onClick={() => onSelect(key)}
          >
            {PANELS[key].title}
            {paneBadges[key] ? <span className="pane-tab-badge">{paneBadges[key]}</span> : null}
          </button>
        ))}
      </div>

      <div className="pane-body">
        <span className="panel-eyebrow">{pane.eyebrow}</span>
        <h2>{pane.title}</h2>
        {renderPaneBody()}
      </div>
    </aside>
  );
}
