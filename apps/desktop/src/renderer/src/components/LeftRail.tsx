import { memo, useCallback, useEffect, useState } from "react";
import type { AppInfo, ThreadSummary, WorkspaceState } from "@shared";

interface LeftRailProps {
  appInfo: AppInfo | null;
  workspaceState: WorkspaceState;
  isOpeningWorkspace: boolean;
  isCreatingThread: boolean;
  archivingThreadId: string | null;
  removingWorkspaceId: string | null;
  runningThreadId: string | null;
  isSettingsView: boolean;
  isVoicePanelOpen: boolean;
  onOpenWorkspace: () => void | Promise<void>;
  onCreateThread: (workspaceId: string) => void | Promise<void>;
  onRemoveWorkspace: (workspaceId: string) => void | Promise<void>;
  onOpenSettings: () => void | Promise<void>;
  onToggleVoicePanel: () => void | Promise<void>;
  onSelectWorkspace: (workspaceId: string) => void | Promise<void>;
  onSelectThread: (workspaceId: string, threadId: string) => void | Promise<void>;
  onArchiveThread: (workspaceId: string, threadId: string) => void | Promise<void>;
}

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

function ArchiveIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path
        d="M3 4.5h10M4.1 4.5h7.8v7.15A1.35 1.35 0 0 1 10.55 13h-5.1A1.35 1.35 0 0 1 4.1 11.65Zm1-1.75h5.8a.95.95 0 0 1 .95.95V4.5H4.15v-.8a.95.95 0 0 1 .95-.95Zm1.35 3.2h5.1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path
        d="M8 3.15a4.85 4.85 0 1 0 0 9.7 4.85 4.85 0 0 0 0-9.7Zm0 2.2a2.65 2.65 0 1 1 0 5.3 2.65 2.65 0 0 1 0-5.3ZM8 1.75v1.4M8 12.85v1.4M3.15 8h-1.4M14.25 8h-1.4M4.56 4.56l-.99-.99M12.43 12.43l-.99-.99M11.44 4.56l.99-.99M3.57 12.43l.99-.99"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.15"
      />
    </svg>
  );
}

function VoiceIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path
        d="M8 2.25a2.25 2.25 0 0 1 2.25 2.25v3A2.25 2.25 0 0 1 8 9.75 2.25 2.25 0 0 1 5.75 7.5v-3A2.25 2.25 0 0 1 8 2.25Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.15"
      />
      <path
        d="M3.75 7.25a4.25 4.25 0 0 0 8.5 0M8 11.5v2.25M5.75 13.75h4.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.15"
      />
    </svg>
  );
}

function MoreActionsIcon() {
  return <span aria-hidden="true" className="project-row-action-dots">...</span>;
}

const THREAD_PREVIEW_LIMIT = 6;
type ProjectSummary = WorkspaceState["projects"][number];

type ThreadStatusTone = "running" | "approval" | "input";

function resolveThreadStatus(
  thread: ThreadSummary,
  runningThreadId: string | null
): { label: string; tone: ThreadStatusTone } | null {
  if (thread.hasPendingApproval || thread.state === "approval") {
    return { label: "Approval", tone: "approval" };
  }

  if (thread.hasPendingUserInput || thread.state === "input") {
    return { label: "Input needed", tone: "input" };
  }

  if (thread.isRunning || runningThreadId === thread.id || thread.state === "running") {
    return { label: "Running", tone: "running" };
  }

  return null;
}

function visibleThreadsForProject(project: ProjectSummary, expanded: boolean) {
  if (expanded || project.threads.length <= THREAD_PREVIEW_LIMIT) {
    return project.threads;
  }

  const previewThreads = project.threads.slice(0, THREAD_PREVIEW_LIMIT);
  if (
    !project.currentThreadId ||
    previewThreads.some((thread) => thread.id === project.currentThreadId)
  ) {
    return previewThreads;
  }

  const currentThread = project.threads.find((thread) => thread.id === project.currentThreadId);
  if (!currentThread) {
    return previewThreads;
  }

  return [
    currentThread,
    ...project.threads
      .filter((thread) => thread.id !== project.currentThreadId)
      .slice(0, THREAD_PREVIEW_LIMIT - 1)
  ];
}

interface ProjectThreadRowProps {
  projectId: string;
  thread: ThreadSummary;
  isActiveThread: boolean;
  isConfirmingArchive: boolean;
  isArchivingThread: boolean;
  isArchiveDisabled: boolean;
  archiveTitle: string;
  statusLabel: string | null;
  statusTone: ThreadStatusTone | null;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onArchiveThread: (workspaceId: string, threadId: string) => void;
  onToggleArchiveConfirm: (threadId: string) => void;
}

const ProjectThreadRow = memo(function ProjectThreadRow({
  projectId,
  thread,
  isActiveThread,
  isConfirmingArchive,
  isArchivingThread,
  isArchiveDisabled,
  archiveTitle,
  statusLabel,
  statusTone,
  onSelectThread,
  onArchiveThread,
  onToggleArchiveConfirm
}: ProjectThreadRowProps) {
  const [isHovered, setIsHovered] = useState(false);
  const threadRowClassNames = ["project-thread-row"];

  if (isActiveThread) {
    threadRowClassNames.push("project-thread-button-active");
  }

  if (isHovered) {
    threadRowClassNames.push("project-thread-row-hovered");
  }

  if (statusTone) {
    threadRowClassNames.push(`project-thread-row-${statusTone}`);
  }

  return (
    <li>
      <div
        className={threadRowClassNames.join(" ")}
        data-thread-id={thread.id}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <button
          type="button"
          className="project-thread-button"
          onClick={() => onSelectThread(projectId, thread.id)}
          title={thread.title}
        >
          <span className="project-thread-line">
            <span className="project-thread-title">{thread.title}</span>
            {statusLabel && statusTone ? (
              <span className={`project-thread-status-pill project-thread-status-pill-${statusTone}`}>
                {statusLabel}
              </span>
            ) : null}
          </span>
        </button>
        <span className="project-thread-meta">
          <span className="project-thread-time-slot">
            {isConfirmingArchive ? (
              <button
                type="button"
                className="project-thread-confirm-button"
                onClick={() => onArchiveThread(projectId, thread.id)}
                disabled={isArchivingThread}
                aria-label={`Confirm archive ${thread.title}`}
              >
                {isArchivingThread ? "..." : "Confirm"}
              </button>
            ) : (
              <>
                <span className="project-thread-time">{thread.updatedAt}</span>
                <button
                  type="button"
                  className="project-thread-archive-button"
                  onClick={() => onToggleArchiveConfirm(thread.id)}
                  disabled={isArchiveDisabled}
                  aria-label={`Archive ${thread.title}`}
                  title={archiveTitle}
                >
                  <ArchiveIcon />
                </button>
              </>
            )}
          </span>
        </span>
      </div>
    </li>
  );
});

export function LeftRail({
  appInfo,
  workspaceState,
  isOpeningWorkspace,
  isCreatingThread,
  archivingThreadId,
  removingWorkspaceId,
  runningThreadId,
  isSettingsView,
  isVoicePanelOpen,
  onOpenWorkspace,
  onCreateThread,
  onRemoveWorkspace,
  onOpenSettings,
  onToggleVoicePanel,
  onSelectWorkspace,
  onSelectThread,
  onArchiveThread
}: LeftRailProps) {
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [expandedThreadLists, setExpandedThreadLists] = useState<Record<string, boolean>>({});
  const [confirmThreadId, setConfirmThreadId] = useState<string | null>(null);
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const currentProject = workspaceState.projects.find((project) => project.isCurrent) ?? null;
  const currentProjectId = currentProject?.id ?? null;

  useEffect(() => {
    if (!currentProjectId) {
      return;
    }

    setExpandedProjects((current) =>
      current[currentProjectId]
        ? current
        : {
            ...current,
            [currentProjectId]: true
          }
    );
  }, [currentProjectId, workspaceState.projects]);

  const toggleProject = (workspaceId: string) => {
    setExpandedProjects((current) => ({
      ...current,
      [workspaceId]: !current[workspaceId]
    }));
  };

  const handleSelectThread = useCallback(
    (workspaceId: string, threadId: string) => {
      setConfirmThreadId(null);
      setOpenProjectMenuId(null);
      void onSelectThread(workspaceId, threadId);
    },
    [onSelectThread]
  );

  const handleArchiveThread = useCallback(
    (workspaceId: string, threadId: string) => {
      void onArchiveThread(workspaceId, threadId);
    },
    [onArchiveThread]
  );

  const handleToggleArchiveConfirm = useCallback((threadId: string) => {
    setConfirmThreadId((current) => (current === threadId ? null : threadId));
  }, []);

  useEffect(() => {
    if (!confirmThreadId) {
      return;
    }

    const stillExists = workspaceState.projects.some((project) =>
      project.threads.some((thread) => thread.id === confirmThreadId)
    );

    if (!stillExists) {
      setConfirmThreadId(null);
    }
  }, [confirmThreadId, workspaceState.projects]);

  useEffect(() => {
    if (!openProjectMenuId) {
      return;
    }

    const stillExists = workspaceState.projects.some((project) => project.id === openProjectMenuId);

    if (!stillExists) {
      setOpenProjectMenuId(null);
    }
  }, [openProjectMenuId, workspaceState.projects]);

  useEffect(() => {
    if (!openProjectMenuId) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || event.target.closest("[data-project-menu-root]")) {
        return;
      }

      setOpenProjectMenuId(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openProjectMenuId]);

  return (
    <aside
      className="left-rail panel stagger-1"
      title={appInfo ? `${appInfo.name} ${appInfo.version}` : undefined}
    >
      <div className="rail-window-strip" aria-hidden="true" />

      <div className="rail-utility-list">
        <button
          type="button"
          className="rail-utility-button"
          onClick={() => void onOpenWorkspace()}
          disabled={isOpeningWorkspace}
          title="Open repo"
          aria-label="Open repo"
        >
          <OpenIcon />
          <span>{isOpeningWorkspace ? "Opening repo..." : "Open repo"}</span>
        </button>
      </div>

      <div className="rail-section-label">Threads</div>

      <div className="project-tree">
        {workspaceState.projects.map((project) => {
          const expanded = expandedProjects[project.id] ?? false;
          const hasThreads = project.threads.length > 0;
          const isThreadListExpanded = expandedThreadLists[project.id] ?? false;
          const hasHiddenThreads = project.threads.length > THREAD_PREVIEW_LIMIT;
          const visibleThreads = visibleThreadsForProject(project, isThreadListExpanded);
          const hiddenThreadCount = Math.max(project.threads.length - THREAD_PREVIEW_LIMIT, 0);

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
                    setOpenProjectMenuId(null);
                    void onSelectWorkspace(project.id);
                  }}
                  title={project.path}
                >
                  <FolderIcon />
                  <span className="project-select-button-copy">
                    <span className="project-name">{project.name}</span>
                  </span>
                </button>
                <div className="project-row-actions">
                  <button
                    type="button"
                    className="project-row-action-button"
                    onClick={() => void onCreateThread(project.id)}
                    disabled={isCreatingThread}
                    aria-label={`New thread in ${project.name}`}
                    title={`New thread in ${project.name}`}
                  >
                    <PlusIcon />
                  </button>
                  <div className="project-row-menu-root" data-project-menu-root>
                    <button
                      type="button"
                      className={
                        openProjectMenuId === project.id
                          ? "project-row-action-button project-row-action-button-active"
                          : "project-row-action-button"
                      }
                      onClick={() =>
                        setOpenProjectMenuId((current) => (current === project.id ? null : project.id))
                      }
                      disabled={
                        removingWorkspaceId !== null || (runningThreadId !== null && project.isCurrent)
                      }
                      aria-label={`More actions for ${project.name}`}
                      title={
                        runningThreadId !== null && project.isCurrent
                          ? "Stop active work before removing this project"
                          : `More actions for ${project.name}`
                      }
                    >
                      <MoreActionsIcon />
                    </button>
                    {openProjectMenuId === project.id ? (
                      <div className="project-row-menu">
                        <button
                          type="button"
                          className="project-row-menu-item project-row-menu-item-danger"
                          onClick={() => {
                            setOpenProjectMenuId(null);
                            void onRemoveWorkspace(project.id);
                          }}
                          disabled={
                            removingWorkspaceId !== null || (runningThreadId !== null && project.isCurrent)
                          }
                        >
                          {removingWorkspaceId === project.id ? "Removing..." : "Remove project"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {expanded ? (
                hasThreads ? (
                  <ul className="project-thread-list">
                    {visibleThreads.map((thread) => {
                      const threadStatus = resolveThreadStatus(thread, runningThreadId);

                      return (
                        <ProjectThreadRow
                          key={thread.id}
                          projectId={project.id}
                          thread={thread}
                          isActiveThread={project.currentThreadId === thread.id}
                          isConfirmingArchive={confirmThreadId === thread.id}
                          isArchivingThread={archivingThreadId === thread.id}
                          isArchiveDisabled={
                            archivingThreadId !== null ||
                            thread.isRunning ||
                            runningThreadId === thread.id
                          }
                          archiveTitle={
                            thread.isRunning || runningThreadId === thread.id
                              ? "Stop active work before archiving"
                              : `Archive ${thread.title}`
                          }
                          statusLabel={threadStatus?.label ?? null}
                          statusTone={threadStatus?.tone ?? null}
                          onSelectThread={handleSelectThread}
                          onArchiveThread={handleArchiveThread}
                          onToggleArchiveConfirm={handleToggleArchiveConfirm}
                        />
                      );
                    })}
                    {hasHiddenThreads ? (
                      <li>
                        <button
                          type="button"
                          className="project-thread-show-more-button"
                          onClick={() =>
                            setExpandedThreadLists((current) => ({
                              ...current,
                              [project.id]: !isThreadListExpanded
                            }))
                          }
                        >
                          {isThreadListExpanded ? "Show less" : `Show ${hiddenThreadCount} more`}
                        </button>
                      </li>
                    ) : null}
                  </ul>
                ) : (
                  <div className="project-empty">No threads</div>
                )
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="rail-footer">
        <button
          type="button"
          className={isVoicePanelOpen ? "rail-footer-button rail-footer-button-active" : "rail-footer-button"}
          onClick={() => void onToggleVoicePanel()}
          aria-label={isVoicePanelOpen ? "Hide realtime panel" : "Show realtime panel"}
          title="Realtime"
        >
          <VoiceIcon />
          <span>Realtime</span>
        </button>
        <button
          type="button"
          className={isSettingsView ? "rail-footer-button rail-footer-button-active" : "rail-footer-button"}
          onClick={() => void onOpenSettings()}
          aria-label="Open settings"
          title="Settings"
        >
          <SettingsIcon />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}
