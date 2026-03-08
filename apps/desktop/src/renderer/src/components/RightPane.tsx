const PANELS = {
  plan: {
    title: "Plan",
    body: "Structured steps land here once Codex starts thinking in public.",
  },
  diff: {
    title: "Diff",
    body: "Unified diff view. Empty in commit 1 by design.",
  },
  commands: {
    title: "Commands",
    body: "Tool activity, shell lines, and side effects will stack here.",
  },
  approvals: {
    title: "Approvals",
    body: "Risky actions pause here. Buttons later. Placeholder now.",
  },
  errors: {
    title: "Errors",
    body: "Developer mode rail. Quiet until something real fails.",
  },
} as const;

type PaneKey = keyof typeof PANELS;

interface RightPaneProps {
  activePane: PaneKey;
  onSelect: (pane: PaneKey) => void;
}

export function RightPane({ activePane, onSelect }: RightPaneProps) {
  const pane = PANELS[activePane];

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
          </button>
        ))}
      </div>

      <div className="pane-body">
        <span className="panel-eyebrow">Utility</span>
        <h2>{pane.title}</h2>
        <p>{pane.body}</p>
      </div>
    </aside>
  );
}
