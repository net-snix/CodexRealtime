import { useEffect, useState } from "react";
import type { ApprovalDecision, TimelineState, WorkspaceState } from "@shared";

const PANELS = {
  plan: {
    title: "Plan",
    eyebrow: "Thread state"
  },
  diff: {
    title: "Diff",
    eyebrow: "Changes"
  },
  commands: {
    title: "Commands",
    eyebrow: "Activity"
  },
  approvals: {
    title: "Approvals",
    eyebrow: "Decisions"
  },
  errors: {
    title: "Errors",
    eyebrow: "Logs"
  },
  settings: {
    title: "Settings",
    eyebrow: "Archive"
  }
} as const;

type PaneKey = keyof typeof PANELS;

interface RightPaneProps {
  activePane: PaneKey;
  onSelect: (pane: PaneKey) => void;
  timelineState: TimelineState;
  workspaceState: WorkspaceState;
  archivingThreadId: string | null;
  restoringThreadId: string | null;
  archiveError: string | null;
  submittingApprovals: Record<string, ApprovalDecision>;
  approvalErrors: Record<string, string>;
  submittingUserInputs: Record<string, boolean>;
  userInputErrors: Record<string, string>;
  onArchiveThread: (workspaceId: string, threadId: string) => void | Promise<void>;
  onUnarchiveThread: (workspaceId: string, threadId: string) => void | Promise<void>;
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
  workspaceState,
  archivingThreadId,
  restoringThreadId,
  archiveError,
  submittingApprovals,
  approvalErrors,
  submittingUserInputs,
  userInputErrors,
  onArchiveThread,
  onUnarchiveThread,
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
  const currentProject = workspaceState.projects.find((project) => project.isCurrent) ?? null;
  const currentThread =
    currentProject?.threads.find((thread) => thread.id === workspaceState.currentThreadId) ?? null;
  const archivedProjects = workspaceState.archivedProjects;
  const archivedThreadCount = archivedProjects.reduce(
    (count, project) => count + project.threads.length,
    0
  );
  const paneBadges: Partial<Record<PaneKey, number>> = {
    plan: planSteps.length,
    approvals: approvals.length + userInputs.length,
    settings: archivedThreadCount
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
          <p>Steps will land here.</p>
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
          <p>Edits will preview here.</p>
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
            <p>{timelineState.statusLabel ?? "No command activity."}</p>
          </article>
          <article className="dossier-card">
            <div className="dossier-row">
              <span className="dossier-index">Stream</span>
              <span className="session-meta">{timelineState.events.length} events</span>
            </div>
            <p>Thread pulse and event count.</p>
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
                <p>{approval.detail || "No extra context."}</p>
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
                    {isPromptSubmitting ? "Submitting..." : "Submit"}
                  </button>
                </div>
                <p className="request-note">All fields required.</p>
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
          <p>Requests will queue here.</p>
        </div>
      );
    }

    if (activePane === "settings") {
      return (
        <div className="dossier-stack">
          <article className="dossier-card">
            <div className="dossier-row">
              <span className="dossier-index">Current chat</span>
              <span className="session-meta">{currentProject?.name ?? "No workspace"}</span>
            </div>
            <h3>{currentThread?.title ?? "Nothing selected"}</h3>
            <p>
              {currentThread
                ? "Archive the selected chat. It will leave the active thread list and stay available below."
                : "Open or create a thread first."}
            </p>
            {currentProject && currentThread ? (
              <div className="approval-actions">
                <button
                  type="button"
                  className="request-action-button request-action-button-primary"
                  disabled={timelineState.isRunning || archivingThreadId === currentThread.id}
                  onClick={() => void onArchiveThread(currentProject.id, currentThread.id)}
                >
                  {archivingThreadId === currentThread.id ? "Archiving..." : "Archive chat"}
                </button>
              </div>
            ) : null}
            {timelineState.isRunning && currentThread ? (
              <p className="request-note">Stop active work before archiving this chat.</p>
            ) : null}
          </article>

          {archivedProjects.length > 0 ? (
            archivedProjects.map((project) => (
              <article key={project.id} className="dossier-card">
                <div className="dossier-row">
                  <h3>{project.name}</h3>
                  <span className="session-meta">{project.threads.length} archived</span>
                </div>
                <div className="archive-thread-list">
                  {project.threads.map((thread) => (
                    <div key={thread.id} className="archive-thread-row">
                      <div className="archive-thread-copy">
                        <span className="archive-thread-title">{thread.title}</span>
                        <span className="archive-thread-meta">{thread.updatedAt}</span>
                      </div>
                      <button
                        type="button"
                        className="request-action-button request-action-button-ghost"
                        disabled={restoringThreadId === thread.id}
                        onClick={() => void onUnarchiveThread(project.id, thread.id)}
                      >
                        {restoringThreadId === thread.id ? "Restoring..." : "Restore"}
                      </button>
                    </div>
                  ))}
                </div>
              </article>
            ))
          ) : (
            <div className="pane-empty-state">
              <h3>No archived chats</h3>
              <p>Archived threads will show up here.</p>
            </div>
          )}

          {archiveError ? <p className="request-error">{archiveError}</p> : null}
        </div>
      );
    }

    return (
      <div className="pane-empty-state">
        <h3>Quiet rail</h3>
        <p>No error events.</p>
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
