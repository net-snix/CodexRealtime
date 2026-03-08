import type { AppInfo, ThreadSummary, WorkspaceSummary } from "@shared";

interface LeftRailProps {
  appInfo: AppInfo | null;
  workspaces: WorkspaceSummary[];
  threads: ThreadSummary[];
}

export function LeftRail({ appInfo, workspaces, threads }: LeftRailProps) {
  return (
    <aside className="left-rail panel stagger-1">
      <div className="panel-eyebrow">Codex Realtime</div>
      <div className="brand-lockup">
        <div>
          <h1>Speaking terminal.</h1>
          <p>A voice-native SWE shell. Warm paper. Sharp edges.</p>
        </div>
        <div className="brand-chip">Commit 1</div>
      </div>

      <section className="rail-section">
        <header>
          <span>Session</span>
          <span>{appInfo?.platform ?? "darwin"}</span>
        </header>
        <div className="session-card">
          <div className="session-name">{appInfo?.name ?? "Codex Realtime"}</div>
          <div className="session-meta">Version {appInfo?.version ?? "0.1.0"}</div>
        </div>
      </section>

      <section className="rail-section">
        <header>
          <span>Recent workspaces</span>
          <span>{workspaces.length}</span>
        </header>
        <ul className="rail-list">
          {workspaces.map((workspace) => (
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
          <span>{threads.length}</span>
        </header>
        <ul className="rail-list compact">
          {threads.map((thread) => (
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
