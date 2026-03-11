import { useEffect, useRef, useState } from "react";
import type { TimelineDiffEntry, TimelinePlan, TimelineState } from "@shared";
import { TimelineRichText } from "./TimelineRichText";

const PANELS = {
  plan: {
    title: "Plan",
    eyebrow: "Thread state"
  },
  diff: {
    title: "Diff",
    eyebrow: "Changes"
  }
} as const;

type PaneKey = keyof typeof PANELS;

interface RightPaneProps {
  activePane: PaneKey;
  onSelect: (pane: PaneKey) => void;
  onClose: () => void;
  timelineState: TimelineState;
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

  return `${trimmed.slice(0, 1800)}\n\n...diff preview truncated`;
};

const downloadTextFile = (filename: string, text: string, mimeType: string) => {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const safeFileFragment = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "export";

const resolvePlanExportName = (plan: TimelinePlan) => `${safeFileFragment(plan.title)}.md`;
const resolveDiffExportName = (entry: TimelineDiffEntry) => `${safeFileFragment(entry.title)}.diff`;

function ActionDotsIcon() {
  return <span aria-hidden="true" className="pane-icon-dots">...</span>;
}

function ClosePaneIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="pane-close-icon">
      <path
        d="M3 3 9 9M9 3 3 9"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

const renderDiffCard = (entry: TimelineDiffEntry, emphasis = false) => (
  <article
    key={entry.id}
    className={emphasis ? "dossier-card dossier-card-active" : "dossier-card"}
  >
    <div className="dossier-row">
      <span className="dossier-status dossier-status-completed">
        +{entry.additions} -{entry.deletions}
      </span>
      <span className="dossier-index">{entry.files.length} files</span>
    </div>
    <h3>{entry.title}</h3>
    {entry.files.length > 0 ? (
      <div className="pane-file-list">
        {entry.files.map((file) => (
          <div key={`${entry.id}-${file.path}`} className="pane-file-row">
            <span className="pane-file-path">{file.path}</span>
            <span className="pane-file-meta">
              +{file.additions} -{file.deletions}
            </span>
          </div>
        ))}
      </div>
    ) : null}
    {entry.diff.trim() ? <pre className="diff-preview">{truncateDiff(entry.diff)}</pre> : null}
  </article>
);

export function RightPane({
  activePane,
  onSelect,
  onClose,
  timelineState
}: RightPaneProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const paneKey: PaneKey = activePane === "diff" ? "diff" : "plan";
  const pane = PANELS[paneKey];
  const activePlan = timelineState.activePlan ?? timelineState.latestProposedPlan;
  const diffEntries = timelineState.turnDiffs;
  const activeDiff = timelineState.activeDiffPreview ?? diffEntries.at(-1) ?? null;
  const paneTimestamp =
    paneKey === "plan"
      ? activePlan?.createdAt ?? null
      : activeDiff?.createdAt ?? null;
  const paneBadges: Partial<Record<PaneKey, number>> = {
    plan: activePlan?.steps.length ?? (activePlan ? 1 : 0),
    diff: diffEntries.length
  };
  const canCopy = paneKey === "plan" ? Boolean(activePlan?.text.trim()) : Boolean(activeDiff?.diff.trim());
  const canDownload = canCopy;

  const handleCopy = async () => {
    const text = paneKey === "plan" ? activePlan?.text ?? "" : activeDiff?.diff ?? "";

    if (!text.trim()) {
      return;
    }

    await navigator.clipboard.writeText(text);
    setMenuOpen(false);
  };

  const handleDownload = () => {
    if (paneKey === "plan") {
      if (!activePlan?.text.trim()) {
        return;
      }

      downloadTextFile(resolvePlanExportName(activePlan), activePlan.text, "text/markdown;charset=utf-8");
      setMenuOpen(false);
      return;
    }

    if (!activeDiff?.diff.trim()) {
      return;
    }

    downloadTextFile(resolveDiffExportName(activeDiff), activeDiff.diff, "text/plain;charset=utf-8");
    setMenuOpen(false);
  };

  useEffect(() => {
    setMenuOpen(false);
  }, [paneKey]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || menuRef.current?.contains(event.target)) {
        return;
      }

      setMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [menuOpen]);

  const renderPaneBody = () => {
    if (paneKey === "plan") {
      return activePlan ? (
        <div className="dossier-stack">
          <article className="dossier-card dossier-card-active">
            <div className="dossier-row">
              <span className="dossier-status dossier-status-in_progress">
                {timelineState.activePlan ? "Live plan" : "Latest plan"}
              </span>
              <span className="dossier-index">
                {activePlan.steps.length > 0 ? `${activePlan.steps.length} steps` : "Draft"}
              </span>
            </div>
            <h3>{activePlan.title}</h3>
            <TimelineRichText className="pane-rich-text" text={activePlan.text} />
          </article>
          {activePlan.steps.map((step, index) => (
            <article key={`${activePlan.id}-${step.step}-${index}`} className="dossier-card">
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
          <p>Plans will land here once the worker starts sketching the approach.</p>
        </div>
      );
    }

    if (paneKey === "diff") {
      return activeDiff ? (
        <div className="dossier-stack">
          {renderDiffCard(activeDiff, true)}
          {diffEntries
            .filter((entry) => entry.id !== activeDiff.id)
            .map((entry) => renderDiffCard(entry))}
        </div>
      ) : (
        <div className="pane-empty-state">
          <h3>No diff yet</h3>
          <p>Changed files and previews will show up here.</p>
        </div>
      );
    }

    return null;
  };

  return (
    <aside className="right-pane panel stagger-3">
      <div className="right-pane-window-strip" aria-hidden="true" />

      <div className="pane-header-bar">
        <div className="pane-header-copy">
          <span className={`pane-header-badge pane-header-badge-${paneKey}`}>{pane.title}</span>
          {paneTimestamp ? <span className="pane-header-meta">{paneTimestamp}</span> : null}
        </div>
        <div className="pane-header-actions">
          <div ref={menuRef} className="pane-action-menu">
            <button
              type="button"
              className={`pane-icon-button${menuOpen ? " pane-icon-button-active" : ""}`}
              aria-label={`${pane.title} actions`}
              onClick={() => setMenuOpen((current) => !current)}
            >
              <ActionDotsIcon />
            </button>
            {menuOpen ? (
              <div className="pane-action-popover">
                <button
                  type="button"
                  className="pane-action-popover-button"
                  onClick={() => void handleCopy()}
                  disabled={!canCopy}
                >
                  Copy {pane.title.toLowerCase()}
                </button>
                <button
                  type="button"
                  className="pane-action-popover-button"
                  onClick={handleDownload}
                  disabled={!canDownload}
                >
                  Download {pane.title.toLowerCase()}
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="pane-icon-button"
            aria-label="Close right pane"
            onClick={onClose}
          >
            <ClosePaneIcon />
          </button>
        </div>
      </div>

      <div className="pane-tabs" role="tablist" aria-label="Utility panels">
        {(Object.keys(PANELS) as PaneKey[]).map((key) => (
          <button
            key={key}
            type="button"
            className={key === paneKey ? "pane-tab active" : "pane-tab"}
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
