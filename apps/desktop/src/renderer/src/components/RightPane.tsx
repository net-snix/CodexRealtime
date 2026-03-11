import { useEffect, useMemo, useRef, useState } from "react";
import type { TimelineDiffEntry, TimelinePlan, TimelineState } from "@shared";
import {
  buildDiffBrowserScopes,
  resolveDiffBrowserView,
  type DiffBrowserViewMode
} from "../right-pane-diff";
import { TimelineRichText } from "./TimelineRichText";
import { RightPaneDiffBrowser } from "./RightPaneDiffBrowser";

const PANELS = {
  plan: {
    title: "Plan"
  },
  diff: {
    title: "Diff"
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
const resolveDiffExportName = (entry: TimelineDiffEntry, filePath?: string | null) =>
  `${safeFileFragment(filePath ?? entry.title)}.diff`;

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

export function RightPane({
  activePane,
  onSelect,
  onClose,
  timelineState
}: RightPaneProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedDiffId, setSelectedDiffId] = useState<string | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [diffViewMode, setDiffViewMode] = useState<DiffBrowserViewMode>("files");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const paneKey: PaneKey = activePane === "diff" ? "diff" : "plan";
  const pane = PANELS[paneKey];
  const activePlan = timelineState.activePlan ?? timelineState.latestProposedPlan;
  const diffEntries = timelineState.turnDiffs;
  const activeDiff = timelineState.activeDiffPreview ?? diffEntries.at(-1) ?? null;
  const diffScopes = useMemo(
    () => buildDiffBrowserScopes(diffEntries, timelineState.activeDiffPreview),
    [diffEntries, timelineState.activeDiffPreview]
  );
  const selectedDiff = selectedDiffId
    ? diffScopes.find((entry) => entry.id === selectedDiffId) ?? null
    : activeDiff;
  const diffViewer = useMemo(
    () => resolveDiffBrowserView(selectedDiff, selectedFilePath, diffViewMode),
    [diffViewMode, selectedDiff, selectedFilePath]
  );
  const paneTimestamp =
    paneKey === "plan"
      ? activePlan?.createdAt ?? null
      : selectedDiff?.createdAt ?? null;
  const paneSummary =
    paneKey === "plan"
      ? activePlan
        ? activePlan.steps.length > 0
          ? `${activePlan.steps.length} steps`
          : "Draft"
        : null
      : diffEntries.length > 0
        ? `${diffEntries.length} revision${diffEntries.length === 1 ? "" : "s"}`
        : null;
  const paneBadges: Partial<Record<PaneKey, number>> = {
    plan: activePlan?.steps.length ?? (activePlan ? 1 : 0),
    diff: diffEntries.length
  };
  const canCopy =
    paneKey === "plan" ? Boolean(activePlan?.text.trim()) : Boolean(diffViewer?.diff.trim());
  const canDownload = canCopy;

  const handleCopy = async () => {
    const text = paneKey === "plan" ? activePlan?.text ?? "" : diffViewer?.diff ?? "";

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

    if (!selectedDiff || !diffViewer?.diff.trim()) {
      return;
    }

    downloadTextFile(
      resolveDiffExportName(
        selectedDiff,
        diffViewMode === "files" ? diffViewer.selectedFile?.path ?? null : null
      ),
      diffViewer.diff,
      "text/plain;charset=utf-8"
    );
    setMenuOpen(false);
  };

  useEffect(() => {
    setMenuOpen(false);
  }, [paneKey]);

  useEffect(() => {
    if (paneKey !== "diff") {
      return;
    }

    if (selectedDiffId && !diffScopes.some((entry) => entry.id === selectedDiffId)) {
      setSelectedDiffId(null);
    }
  }, [diffScopes, paneKey, selectedDiffId]);

  useEffect(() => {
    if (paneKey !== "diff") {
      return;
    }

    if (!selectedDiff || selectedDiff.files.length === 0) {
      setSelectedFilePath(null);
      return;
    }

    if (!selectedFilePath || !selectedDiff.files.some((file) => file.path === selectedFilePath)) {
      setSelectedFilePath(selectedDiff.files[0]?.path ?? null);
    }
  }, [paneKey, selectedDiff, selectedFilePath]);

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
        <div className="pane-plan">
          <section className="pane-plan-summary">
            <div className="pane-plan-meta">
              <span className="pane-plan-status">
                {timelineState.activePlan ? "Live plan" : "Latest plan"}
              </span>
              {activePlan.createdAt ? (
                <span className="pane-plan-meta-copy">{activePlan.createdAt}</span>
              ) : null}
            </div>
            <h3>{activePlan.title}</h3>
            <TimelineRichText className="pane-rich-text" text={activePlan.text} />
          </section>
          {activePlan.steps.length > 0 ? (
            <ol className="pane-plan-steps">
              {activePlan.steps.map((step, index) => (
                <li key={`${activePlan.id}-${step.step}-${index}`} className="pane-plan-step">
                  <span className="pane-plan-step-index">{index + 1}</span>
                  <div className="pane-plan-step-copy">
                    <span className="pane-plan-step-text">{step.step}</span>
                    <span className={`pane-plan-step-status pane-plan-step-status-${step.status}`}>
                      {PLAN_STATUS_LABELS[step.status] ?? step.status}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : (
        <div className="pane-empty-state">
          <h3>No plan yet</h3>
          <p>Plans will land here once the worker starts sketching the approach.</p>
        </div>
      );
    }

    if (paneKey === "diff") {
      return (
        <RightPaneDiffBrowser
          diffScopes={diffScopes}
          selectedDiff={selectedDiff}
          selectedFilePath={selectedFilePath}
          viewMode={diffViewMode}
          onSelectDiff={setSelectedDiffId}
          onSelectFile={setSelectedFilePath}
          onChangeViewMode={setDiffViewMode}
        />
      );
    }

    return null;
  };

  return (
    <aside className="right-pane panel stagger-3">
      <div className="right-pane-window-strip" aria-hidden="true" />

      <div className="pane-header-bar">
        <div className="pane-header-copy">
          <h2 className="pane-header-title">{pane.title}</h2>
          {paneSummary || paneTimestamp ? (
            <div className="pane-header-meta-row">
              {paneSummary ? <span className="pane-header-meta">{paneSummary}</span> : null}
              {paneTimestamp ? <span className="pane-header-meta">{paneTimestamp}</span> : null}
            </div>
          ) : null}
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
        {renderPaneBody()}
      </div>
    </aside>
  );
}
