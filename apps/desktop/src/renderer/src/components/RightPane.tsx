import { useEffect, useState } from "react";
import type { ApprovalDecision, TimelineState } from "@shared";

const PANELS = {
  plan: {
    title: "Plan",
    eyebrow: "Live orchestration"
  },
  diff: {
    title: "Diff",
    eyebrow: "Change preview"
  },
  commands: {
    title: "Commands",
    eyebrow: "Operator feed"
  },
  approvals: {
    title: "Approvals",
    eyebrow: "Human gate"
  },
  errors: {
    title: "Errors",
    eyebrow: "Debug rail"
  }
} as const;

type PaneKey = keyof typeof PANELS;

interface RightPaneProps {
  activePane: PaneKey;
  onSelect: (pane: PaneKey) => void;
  timelineState: TimelineState;
  submittingApprovals: Record<string, ApprovalDecision>;
  approvalErrors: Record<string, string>;
  submittingUserInputs: Record<string, boolean>;
  userInputErrors: Record<string, string>;
  onApproveRequest: (id: string, decision?: ApprovalDecision) => void | Promise<void>;
  onDenyRequest: (id: string) => void | Promise<void>;
  onSubmitUserInput: (
    id: string,
    answers: Record<string, string | string[]>
  ) => void | Promise<void>;
}

const PLAN_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed"
};

const APPROVAL_LABELS: Record<ApprovalDecision, string> = {
  accept: "Approve",
  acceptForSession: "Approve for session",
  decline: "Decline",
  cancel: "Cancel"
};

const truncateDiff = (diff: string) => {
  const trimmed = diff.trim();

  if (trimmed.length <= 1800) {
    return trimmed;
  }

  return `${trimmed.slice(0, 1800)}\n\n...diff preview truncated`;
};

export function RightPane({
  activePane,
  onSelect,
  timelineState,
  submittingApprovals,
  approvalErrors,
  submittingUserInputs,
  userInputErrors,
  onApproveRequest,
  onDenyRequest,
  onSubmitUserInput
}: RightPaneProps) {
  const [draftAnswers, setDraftAnswers] = useState<Record<string, Record<string, string>>>({});
  const pane = PANELS[activePane];
  const planSteps = timelineState.planSteps;
  const approvals = timelineState.approvals;
  const userInputs = timelineState.userInputs;
  const diff = timelineState.diff;
  const paneBadges: Partial<Record<PaneKey, number>> = {
    plan: planSteps.length,
    approvals: approvals.length + userInputs.length
  };

  useEffect(() => {
    const activePromptIds = new Set(userInputs.map((prompt) => prompt.id));

    setDraftAnswers((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([requestId]) => activePromptIds.has(requestId))
      ) as Record<string, Record<string, string>>
    );
  }, [userInputs]);

  const setDraftAnswer = (requestId: string, questionId: string, value: string) => {
    setDraftAnswers((current) => ({
      ...current,
      [requestId]: {
        ...(current[requestId] ?? {}),
        [questionId]: value
      }
    }));
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
      return approvals.length > 0 || userInputs.length > 0 ? (
        <div className="dossier-stack">
          {approvals.map((approval) => {
            const pendingDecision = submittingApprovals[approval.id] ?? null;
            const isApprovalSubmitting = approval.isSubmitting || pendingDecision !== null;

            return (
              <article key={approval.id} className="dossier-card dossier-card-alert">
                <div className="dossier-row">
                  <span className="dossier-status dossier-status-alert">
                    {approval.kind === "command" ? "Command approval" : "File approval"}
                  </span>
                  <span className="dossier-index">
                    {isApprovalSubmitting ? "Sending" : "Pending"}
                  </span>
                </div>
                <h3>{approval.title}</h3>
                <p>{approval.detail || "No extra context from Codex."}</p>
                <div className="approval-actions">
                  {approval.availableDecisions.map((decision) => (
                    <button
                      key={decision}
                      type="button"
                      className={`request-action-button ${
                        decision === "decline" || decision === "cancel"
                          ? "request-action-button-ghost"
                          : "request-action-button-primary"
                      }`}
                      disabled={isApprovalSubmitting}
                      onClick={() =>
                        decision === "decline"
                          ? void onDenyRequest(approval.id)
                          : void onApproveRequest(approval.id, decision)
                      }
                    >
                      {pendingDecision === decision ? "Sending..." : APPROVAL_LABELS[decision]}
                    </button>
                  ))}
                </div>
                {approval.availableDecisions.length === 0 ? (
                  <p className="request-note">No decisions surfaced for this approval yet.</p>
                ) : null}
                {approvalErrors[approval.id] ? (
                  <p className="request-error">{approvalErrors[approval.id]}</p>
                ) : null}
              </article>
            );
          })}

          {userInputs.map((prompt) => {
            const promptDrafts = draftAnswers[prompt.id] ?? {};
            const isPromptSubmitting = submittingUserInputs[prompt.id] || prompt.isSubmitting;
            const hasIncompleteAnswer = prompt.questions.some(
              (question) => (promptDrafts[question.id] ?? "").trim().length === 0
            );

            return (
              <article key={prompt.id} className="dossier-card dossier-card-olive">
                <div className="dossier-row">
                  <span className="dossier-status dossier-status-olive">Request user input</span>
                  <span className="dossier-index">
                    {isPromptSubmitting ? "Sending" : `${prompt.questions.length} questions`}
                  </span>
                </div>
                <h3>{prompt.title}</h3>
                <div className="request-input-list">
                  {prompt.questions.map((question) => (
                    <label key={question.id} className="request-question">
                      <span>{question.header}</span>
                      <span className="request-note">{question.question}</span>
                      {question.options.length > 0 ? (
                        <div className="option-pill-row">
                          {question.options.map((option) => (
                            <button
                              key={`${question.id}-${option.label}`}
                              type="button"
                              className="option-pill"
                              title={option.description || option.label}
                              onClick={() =>
                                setDraftAnswer(prompt.id, question.id, option.label)
                              }
                              disabled={isPromptSubmitting}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <input
                        className="request-input"
                        type={question.isSecret ? "password" : "text"}
                        value={promptDrafts[question.id] ?? ""}
                        placeholder={question.options[0]?.label ?? "Type your answer"}
                        disabled={isPromptSubmitting}
                        onChange={(event) =>
                          setDraftAnswer(prompt.id, question.id, event.target.value)
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="approval-actions">
                  <button
                    type="button"
                    className="request-action-button request-action-button-primary"
                    disabled={isPromptSubmitting || hasIncompleteAnswer}
                    onClick={() => void onSubmitUserInput(prompt.id, promptDrafts)}
                  >
                    {isPromptSubmitting
                      ? "Submitting..."
                      : "Send answers"}
                  </button>
                </div>
                <p className="request-note">All answers required.</p>
                {userInputErrors[prompt.id] ? (
                  <p className="request-error">{userInputErrors[prompt.id]}</p>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="pane-empty-state">
          <h3>No blockers</h3>
          <p>Approvals and clarification prompts will queue here as action cards.</p>
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
