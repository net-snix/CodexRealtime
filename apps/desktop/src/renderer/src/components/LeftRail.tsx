import type { AppInfo, SessionState, WorkspaceState } from "@shared";

interface LeftRailProps {
  appInfo: AppInfo | null;
  sessionState: SessionState | null;
  workspaceState: WorkspaceState;
  currentThreadId: string | null;
  isOpeningWorkspace: boolean;
  onOpenWorkspace: () => void | Promise<void>;
  onOpenCurrentWorkspace: () => void | Promise<void>;
  onSelectWorkspace: (workspaceId: string) => void | Promise<void>;
  onSelectThread: (threadId: string) => void | Promise<void>;
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
  currentThreadId,
  isOpeningWorkspace,
  onOpenWorkspace,
  onOpenCurrentWorkspace,
  onSelectWorkspace,
  onSelectThread
}: LeftRailProps) {
  const currentWorkspace = workspaceState.currentWorkspace;
  const recentWorkspaces = workspaceState.recentWorkspaces
    .filter((workspace) => workspace.id !== currentWorkspace?.id)
    .slice(0, 4);
  const sessionNote = sessionState?.error
    ? sessionState.error
    : sessionState?.features.realtimeConversation
      ? "Voice ready"
      : "Voice off";

  return (
    <aside
      className="left-rail panel stagger-1"
      title={appInfo ? `${appInfo.name} ${appInfo.version}` : undefined}
    >
      <div className="panel-eyebrow">Workspace</div>
      <div className="workspace-summary">
        <div className="workspace-summary-main">
          <h1>{currentWorkspace?.name ?? "Choose repo"}</h1>
          <p>{currentWorkspace?.path ?? "Open a repo to show threads."}</p>
        </div>
        <div className="workspace-summary-meta">
          <div className="brand-chip">{workspaceState.threads.length}</div>
          <span className={`session-inline-dot state-${sessionState?.status ?? "loading"}`} />
        </div>
      </div>

      <div className="workspace-toolbar">
        <button
          type="button"
          className="workspace-tool"
          onClick={() => void onOpenWorkspace()}
        >
          {isOpeningWorkspace ? "Opening" : "Open"}
        </button>
        <button
          type="button"
          className="workspace-tool workspace-tool-secondary"
          onClick={() => void onOpenCurrentWorkspace()}
        >
          Current
        </button>
      </div>

      {recentWorkspaces.length > 0 ? (
        <section className="rail-section">
          <header>
            <span>Repos</span>
            <span>{recentWorkspaces.length}</span>
          </header>
          <ul className="rail-list rail-list-repos">
            {recentWorkspaces.map((workspace) => (
              <li key={workspace.id}>
                <button
                  type="button"
                  className="rail-list-button rail-list-button-repo"
                  onClick={() => void onSelectWorkspace(workspace.id)}
                  title={workspace.path}
                >
                  <span className="list-title">{workspace.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rail-section rail-section-primary">
        <header>
          <span>Threads</span>
          <span>{workspaceState.threads.length}</span>
        </header>
        <ul className="rail-list rail-list-threads">
          {workspaceState.threads.map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                className={
                  thread.id === currentThreadId
                    ? "rail-list-button rail-list-button-thread rail-list-button-active"
                    : "rail-list-button rail-list-button-thread"
                }
                onClick={() => void onSelectThread(thread.id)}
                title={thread.title}
              >
                <span className="list-title">{thread.title}</span>
                <span className="list-meta">{thread.updatedAt}</span>
              </button>
            </li>
          ))}
          {workspaceState.threads.length === 0 ? (
            <li>
              <div className="rail-empty">No threads yet</div>
            </li>
          ) : null}
        </ul>
      </section>

      <div className="session-inline">
        <div className="session-inline-main">
          <span className={`session-inline-dot state-${sessionState?.status ?? "loading"}`} />
          <span>{sessionLabel(sessionState)}</span>
          {sessionState?.account?.planType ? <span>{sessionState.account.planType}</span> : null}
        </div>
        <div className="session-inline-note">{sessionNote}</div>
      </div>
    </aside>
  );
}
