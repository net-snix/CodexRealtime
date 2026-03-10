import { useEffect, useState } from "react";
import type { AppInfo, SessionState, WorkspaceState } from "@shared";

interface LeftRailProps {
  appInfo: AppInfo | null;
  sessionState: SessionState | null;
  workspaceState: WorkspaceState;
  isOpeningWorkspace: boolean;
  isCreatingThread: boolean;
  onOpenWorkspace: () => void | Promise<void>;
  onOpenCurrentWorkspace: () => void | Promise<void>;
  onCreateThread: () => void | Promise<void>;
  onSelectWorkspace: (workspaceId: string) => void | Promise<void>;
  onSelectThread: (workspaceId: string, threadId: string) => void | Promise<void>;
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

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={expanded ? "project-chevron project-chevron-expanded" : "project-chevron"}
      viewBox="0 0 12 12"
    >
      <path
        d="M3.25 4.5 6 7.25 8.75 4.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg aria-hidden="true" className="project-folder" viewBox="0 0 16 16">
      <path
        d="M2.25 4.75A1.75 1.75 0 0 1 4 3h2.1c.37 0 .72.15.97.41l.92.94H12A1.75 1.75 0 0 1 13.75 6.1v5.15A1.75 1.75 0 0 1 12 13H4a1.75 1.75 0 0 1-1.75-1.75Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path
        d="M2.5 5.2A1.7 1.7 0 0 1 4.2 3.5h2.15c.34 0 .67.13.91.37l.88.83h3.66a1.7 1.7 0 0 1 1.7 1.7v4.9a1.7 1.7 0 0 1-1.7 1.7H4.2a1.7 1.7 0 0 1-1.7-1.7Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path
        d="M8 3.25v9.5M3.25 8h9.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function CurrentIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path
        d="M8 2.75v2.1M8 11.15v2.1M2.75 8h2.1M11.15 8h2.1M5.45 5.45l1.1 1.1M9.45 9.45l1.1 1.1M10.55 5.45l-1.1 1.1M6.55 9.45l-1.1 1.1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.2"
      />
      <circle cx="8" cy="8" r="2.15" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function LeftRail({
  appInfo,
  sessionState,
  workspaceState,
  isOpeningWorkspace,
  isCreatingThread,
  onOpenWorkspace,
  onOpenCurrentWorkspace,
  onCreateThread,
  onSelectWorkspace,
  onSelectThread
}: LeftRailProps) {
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const currentProject = workspaceState.projects.find((project) => project.isCurrent) ?? null;
  const sessionText = sessionState?.account?.planType
    ? `${sessionLabel(sessionState)} ${sessionState.account.planType}`
    : sessionLabel(sessionState);

  useEffect(() => {
    if (!currentProject) {
      return;
    }

    setExpandedProjects((current) => ({
      ...current,
      [currentProject.id]: true
    }));
  }, [currentProject]);

  const toggleProject = (workspaceId: string) => {
    setExpandedProjects((current) => ({
      ...current,
      [workspaceId]: !current[workspaceId]
    }));
  };

  return (
    <aside
      className="left-rail panel stagger-1"
      title={appInfo ? `${appInfo.name} ${appInfo.version}` : undefined}
    >
      <div className="rail-header">
        <div>
          <h1>Threads</h1>
        </div>
        <div className="rail-header-actions">
          <button
            type="button"
            className="rail-icon-button"
            onClick={() => void onCreateThread()}
            title="New thread"
            aria-label="New thread"
            disabled={!currentProject || isCreatingThread}
          >
            <PlusIcon />
          </button>
          <button
            type="button"
            className="rail-icon-button"
            onClick={() => void onOpenWorkspace()}
            title="Open repo"
            aria-label="Open repo"
          >
            <OpenIcon />
          </button>
          <button
            type="button"
            className="rail-icon-button"
            onClick={() => void onOpenCurrentWorkspace()}
            title="Use current repo"
            aria-label="Use current repo"
          >
            <CurrentIcon />
          </button>
        </div>
      </div>

      <div className="project-tree">
        {workspaceState.projects.map((project) => {
          const expanded = expandedProjects[project.id] ?? false;
          const hasThreads = project.threads.length > 0;

          return (
            <section
              key={project.id}
              className={
                project.isCurrent ? "project-group project-group-current" : "project-group"
              }
            >
              <div className="project-row">
                <button
                  type="button"
                  className="project-toggle-button"
                  onClick={() => toggleProject(project.id)}
                  aria-label={expanded ? `Collapse ${project.name}` : `Expand ${project.name}`}
                >
                  <ChevronIcon expanded={expanded} />
                </button>
                <button
                  type="button"
                  className="project-select-button"
                  onClick={() => {
                    setExpandedProjects((current) => ({ ...current, [project.id]: true }));
                    void onSelectWorkspace(project.id);
                  }}
                  title={project.path}
                >
                  <FolderIcon />
                  <span className="project-name">{project.name}</span>
                </button>
              </div>

              {expanded ? (
                hasThreads ? (
                  <ul className="project-thread-list">
                    {project.threads.map((thread) => (
                      <li key={thread.id}>
                        <button
                          type="button"
                          className={
                            project.currentThreadId === thread.id
                              ? "project-thread-button project-thread-button-active"
                              : "project-thread-button"
                          }
                          onClick={() => void onSelectThread(project.id, thread.id)}
                          title={thread.title}
                        >
                          <span className="project-thread-title">{thread.title}</span>
                          <span className="project-thread-meta">
                            {thread.changeSummary ? (
                              <span className="project-thread-counts">
                                {thread.changeSummary.additions > 0 ? (
                                  <span className="thread-count-add">
                                    +{thread.changeSummary.additions}
                                  </span>
                                ) : null}
                                {thread.changeSummary.deletions > 0 ? (
                                  <span className="thread-count-delete">
                                    -{thread.changeSummary.deletions}
                                  </span>
                                ) : null}
                              </span>
                            ) : null}
                            <span className="project-thread-time">{thread.updatedAt}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="project-empty">No threads</div>
                )
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="session-inline">
        <div className="session-inline-main">
          <span className={`session-inline-dot state-${sessionState?.status ?? "loading"}`} />
          <span>{sessionText}</span>
        </div>
        <div className="session-inline-note">{isOpeningWorkspace ? "Opening" : "Voice ready"}</div>
      </div>
    </aside>
  );
}
