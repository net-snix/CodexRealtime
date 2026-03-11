import { useEffect, useState } from "react";
import type {
  ApprovalDecision,
  TimelineApproval,
  TimelineUserInputRequest
} from "@shared";

const APPROVAL_LABELS: Record<ApprovalDecision, string> = {
  accept: "Approve",
  acceptForSession: "Approve for session",
  decline: "Decline",
  cancel: "Cancel"
};

interface TimelineRequestsProps {
  approvals: TimelineApproval[];
  userInputs: TimelineUserInputRequest[];
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

export function TimelineRequests({
  approvals,
  userInputs,
  submittingApprovals,
  approvalErrors,
  submittingUserInputs,
  userInputErrors,
  onApproveRequest,
  onDenyRequest,
  onSubmitUserInput
}: TimelineRequestsProps) {
  const [draftAnswers, setDraftAnswers] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    const activePromptIds = new Set(userInputs.map((prompt) => prompt.id));

    setDraftAnswers((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([requestId]) => activePromptIds.has(requestId))
      ) as Record<string, Record<string, string>>
    );
  }, [userInputs]);

  if (approvals.length === 0 && userInputs.length === 0) {
    return null;
  }

  const setDraftAnswer = (requestId: string, questionId: string, value: string) => {
    setDraftAnswers((current) => ({
      ...current,
      [requestId]: {
        ...(current[requestId] ?? {}),
        [questionId]: value
      }
    }));
  };

  return (
    <div className="timeline-request-stack" aria-live="polite">
      {approvals.map((approval) => {
        const pendingDecision = submittingApprovals[approval.id] ?? null;
        const isApprovalSubmitting = approval.isSubmitting || pendingDecision !== null;

        return (
          <article key={approval.id} className="timeline-request-card dossier-card dossier-card-alert">
            <div className="dossier-row">
              <span className="dossier-status dossier-status-alert">
                {approval.kind === "command" ? "Command approval" : "File approval"}
              </span>
              <span className="dossier-index">{isApprovalSubmitting ? "Sending" : "Pending"}</span>
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
          <article key={prompt.id} className="timeline-request-card dossier-card dossier-card-olive">
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
                          onClick={() => setDraftAnswer(prompt.id, question.id, option.label)}
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
  );
}
