import type { AppInfo, SessionState, WorkspaceState } from "@shared";

interface LeftRailProps {
  appInfo: AppInfo | null;
  sessionState: SessionState | null;
  workspaceState: WorkspaceState;
  isOpeningWorkspace: boolean;
  onOpenWorkspace: () => void | Promise<void>;
}

const sessionLabel = (sessionState: SessionState | null) => {
  if (!sessionState) {
    return "Loading";
  }

  if (sessionState.status === "connected") {
    return "Connected";
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
  onOpenWorkspace
}: LeftRailProps) {
  const featureBadges = [
    sessionState?.features.realtimeConversation ? "realtime" : null,
    sessionState?.features.defaultModeRequestUserInput ? "ask-first" : null,
    sessionState?.features.voiceTranscription ? "transcription" : null
  ].filter(Boolean) as string[];

  return (
    <aside className="left-rail panel stagger-1">
      <div className="panel-eyebrow">Codex Realtime</div>
      <div className="brand-lockup">
        <div>
          <h1>Speaking terminal.</h1>
          <p>A voice-native SWE shell. Warm paper. Sharp edges.</p>
        </div>
        <div className="brand-chip">Phase 3</div>
      </div>

      <button type="button" className="open-workspace-button" onClick={() => void onOpenWorkspace()}>
        {isOpeningWorkspace ? "Opening..." : "Open repo"}
      </button>

      <section className="rail-section">
        <header>
          <span>Codex session</span>
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
              {sessionState?.requiresOpenaiAuth ? "Auth required or still loading" : "No account info yet"}
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
              <span className="feature-badge muted">features pending</span>
            )}
          </div>
        </div>
      </section>

      <section className="rail-section">
        <header>
          <span>Current workspace</span>
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
              <div className="list-subtitle">Pick a repo to create or resume its primary thread.</div>
            </>
          )}
        </div>
      </section>

      <section className="rail-section">
        <header>
          <span>Recent workspaces</span>
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
          <span>Thread memory</span>
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
