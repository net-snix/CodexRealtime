import type { AppInfo, SessionState, WorkspaceState } from "@shared";

interface LeftRailProps {
  appInfo: AppInfo | null;
  sessionState: SessionState | null;
  workspaceState: WorkspaceState;
  isOpeningWorkspace: boolean;
  onOpenWorkspace: () => void | Promise<void>;
  onOpenCurrentWorkspace: () => void | Promise<void>;
}

const sessionLabel = (sessionState: SessionState | null) => {
  if (!sessionState) {
    return "Loading";
  }

  if (sessionState.status === "connected") {
    return "Ready";
  }

  if (sessionState.status === "connecting") {
    return "Connecting";
  }

  return "Error";
};

export function LeftRail({
  appInfo,
  sessionState,
  workspaceState,
  isOpeningWorkspace,
  onOpenWorkspace,
  onOpenCurrentWorkspace
}: LeftRailProps) {
  const featureBadges = [
    sessionState?.features.realtimeConversation ? "Realtime" : null,
    sessionState?.features.defaultModeRequestUserInput ? "Ask first" : null,
    sessionState?.features.voiceTranscription ? "Transcript" : null
  ].filter(Boolean) as string[];

  return (
    <aside className="left-rail panel stagger-1">
      <div className="panel-eyebrow">Workspace</div>
      <div className="brand-lockup">
        <div>
          <h1>Codex Realtime</h1>
          <p>One repo. One thread. Voice when you want it.</p>
        </div>
        <div className="brand-chip">Prototype</div>
      </div>

      <div className="workspace-action-row">
        <button
          type="button"
          className="open-workspace-button"
          onClick={() => void onOpenWorkspace()}
        >
          {isOpeningWorkspace ? "Opening..." : "Open repo"}
        </button>
        <button
          type="button"
          className="open-workspace-button open-workspace-button-secondary"
          onClick={() => void onOpenCurrentWorkspace()}
        >
          This repo
        </button>
      </div>

      <section className="rail-section">
        <header>
          <span>Session</span>
          <span>{appInfo?.platform ?? "darwin"}</span>
        </header>
        <div className={`session-card session-${sessionState?.status ?? "loading"}`}>
          <div className="session-row">
            <div className="session-name">{sessionLabel(sessionState)}</div>
            <div className={`session-state-pill state-${sessionState?.status ?? "loading"}`}>
              {sessionState?.status ?? "loading"}
            </div>
          </div>
          <div className="session-meta">
            {appInfo?.name ?? "Codex Realtime"} · Version {appInfo?.version ?? "0.1.0"}
          </div>
          {sessionState?.account ? (
            <div className="session-account">
              <strong>{sessionState.account.email ?? "Signed in"}</strong>
              <span>
                {sessionState.account.type}
                {sessionState.account.planType ? ` · ${sessionState.account.planType}` : ""}
              </span>
            </div>
          ) : (
            <div className="session-account muted">
              {sessionState?.requiresOpenaiAuth ? "Waiting for login" : "No account yet"}
            </div>
          )}
          {sessionState?.error ? <div className="session-error">{sessionState.error}</div> : null}
          <div className="feature-badges">
            {featureBadges.length > 0 ? (
              featureBadges.map((feature) => (
                <span key={feature} className="feature-badge">
                  {feature}
                </span>
              ))
            ) : (
              <span className="feature-badge muted">Pending</span>
            )}
          </div>
        </div>
      </section>

      <section className="rail-section">
        <header>
          <span>Workspace</span>
          <span>{workspaceState.currentWorkspace ? "bound" : "none"}</span>
        </header>
        <div className="workspace-focus">
          {workspaceState.currentWorkspace ? (
            <>
              <div className="list-title">{workspaceState.currentWorkspace.name}</div>
              <div className="list-subtitle">{workspaceState.currentWorkspace.path}</div>
            </>
          ) : (
            <>
              <div className="list-title">No repo open</div>
              <div className="list-subtitle">Open one to bind the thread.</div>
            </>
          )}
        </div>
      </section>

      <section className="rail-section">
        <header>
          <span>Recent</span>
          <span>{workspaceState.recentWorkspaces.length}</span>
        </header>
        <ul className="rail-list">
          {workspaceState.recentWorkspaces.map((workspace) => (
            <li key={workspace.id} className="rail-list-item">
              <div className="list-title">{workspace.name}</div>
              <div className="list-subtitle">{workspace.path}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rail-section">
        <header>
          <span>Threads</span>
          <span>{workspaceState.threads.length}</span>
        </header>
        <ul className="rail-list compact">
          {workspaceState.threads.map((thread) => (
            <li key={thread.id} className="rail-list-item">
              <div className="list-title">{thread.title}</div>
              <div className="list-subtitle">{thread.updatedAt}</div>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
