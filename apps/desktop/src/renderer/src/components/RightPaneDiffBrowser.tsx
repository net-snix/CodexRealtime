import type { TimelineDiffEntry } from "@shared";
import {
  parseDiffViewerLines,
  resolveDiffBrowserView,
  type DiffBrowserViewMode
} from "../right-pane-diff";

interface RightPaneDiffBrowserProps {
  diffScopes: TimelineDiffEntry[];
  selectedDiff: TimelineDiffEntry | null;
  selectedFilePath: string | null;
  viewMode: DiffBrowserViewMode;
  onSelectDiff: (diffId: string) => void;
  onSelectFile: (filePath: string) => void;
  onChangeViewMode: (viewMode: DiffBrowserViewMode) => void;
}

const diffScopeLabel = (entry: TimelineDiffEntry) =>
  entry.id === "all-changes" ? "All changes" : entry.title;

function DiffModeToggle({
  viewMode,
  onChangeViewMode
}: Pick<RightPaneDiffBrowserProps, "viewMode" | "onChangeViewMode">) {
  return (
    <div className="diff-browser-mode-toggle" role="tablist" aria-label="Diff views">
      {(["files", "patch"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          className={mode === viewMode ? "diff-browser-mode-button active" : "diff-browser-mode-button"}
          onClick={() => onChangeViewMode(mode)}
          role="tab"
          aria-selected={mode === viewMode}
        >
          {mode === "files" ? "Files" : "Patch"}
        </button>
      ))}
    </div>
  );
}

function DiffViewer({
  title,
  subtitle,
  diff
}: {
  title: string;
  subtitle: string;
  diff: string;
}) {
  const lines = parseDiffViewerLines(diff);

  if (!diff.trim()) {
    return (
      <div className="diff-browser-empty-panel">
        <h3>No patch yet</h3>
        <p>The worker has file metadata, but no diff body has landed yet.</p>
      </div>
    );
  }

  return (
    <section className="diff-browser-viewer">
      <header className="diff-browser-viewer-header">
        <div className="diff-browser-viewer-copy">
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </header>
      <div className="diff-browser-codeframe" role="region" aria-label={title}>
        {lines.map((line) => (
          <div
            key={line.id}
            className={`diff-browser-line diff-browser-line-${line.kind}`}
          >
            <span className="diff-browser-gutter">{line.oldNumber ?? ""}</span>
            <span className="diff-browser-gutter">{line.newNumber ?? ""}</span>
            <code>{line.text || " "}</code>
          </div>
        ))}
      </div>
    </section>
  );
}

export function RightPaneDiffBrowser({
  diffScopes,
  selectedDiff,
  selectedFilePath,
  viewMode,
  onSelectDiff,
  onSelectFile,
  onChangeViewMode
}: RightPaneDiffBrowserProps) {
  if (!selectedDiff) {
    return (
      <div className="pane-empty-state">
        <h3>No diff yet</h3>
        <p>Changed files and previews will show up here.</p>
      </div>
    );
  }

  const viewer = resolveDiffBrowserView(selectedDiff, selectedFilePath, viewMode);

  if (!viewer) {
    return null;
  }

  const { diff: viewerDiff, subtitle: viewerSubtitle, title: viewerTitle } = viewer;

  return (
    <div className="diff-browser-shell">
      <div className="diff-browser-toolbar">
        <div className="diff-browser-scope-strip" role="tablist" aria-label="Diff revisions">
          {diffScopes.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={
                entry.id === selectedDiff.id
                  ? "diff-browser-scope-chip active"
                  : "diff-browser-scope-chip"
              }
              onClick={() => onSelectDiff(entry.id)}
              role="tab"
              aria-selected={entry.id === selectedDiff.id}
            >
              <span className="diff-browser-scope-label">{diffScopeLabel(entry)}</span>
              <span className="diff-browser-scope-meta">{entry.createdAt}</span>
            </button>
          ))}
        </div>
        <DiffModeToggle viewMode={viewMode} onChangeViewMode={onChangeViewMode} />
      </div>

      <article className="diff-browser-summary">
        <div className="diff-browser-summary-row">
          <span className="dossier-status dossier-status-completed">
            +{selectedDiff.additions} -{selectedDiff.deletions}
          </span>
          <span className="dossier-index">{selectedDiff.files.length} files</span>
        </div>
        <h3>{selectedDiff.title}</h3>
      </article>

      {viewMode === "files" ? (
        <div className="diff-browser-grid">
          <aside className="diff-browser-file-list" aria-label="Changed files">
            {selectedDiff.files.length > 0 ? (
              selectedDiff.files.map((file) => (
                <button
                  key={`${selectedDiff.id}-${file.path}`}
                  type="button"
                  className={
                    file.path === selectedFilePath
                      ? "diff-browser-file-row active"
                      : "diff-browser-file-row"
                  }
                  onClick={() => onSelectFile(file.path)}
                >
                  <span className="diff-browser-file-path">{file.path}</span>
                  <span className="diff-browser-file-stats">
                    +{file.additions} -{file.deletions}
                  </span>
                </button>
              ))
            ) : (
              <div className="diff-browser-empty-panel">
                <h3>No files</h3>
                <p>This revision has no file list yet.</p>
              </div>
            )}
          </aside>

          <DiffViewer title={viewerTitle} subtitle={viewerSubtitle} diff={viewerDiff} />
        </div>
      ) : (
        <DiffViewer title={viewerTitle} subtitle={viewerSubtitle} diff={viewerDiff} />
      )}
    </div>
  );
}
