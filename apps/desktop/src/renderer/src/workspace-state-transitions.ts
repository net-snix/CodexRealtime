import type { ThreadSummary, WorkspaceProject, WorkspaceState } from "@shared";

interface ArchiveThreadTransition {
  workspaceId: string;
  threadId: string;
  nextThreadId: string | null;
}

interface UnarchiveThreadTransition {
  workspaceId: string;
  threadId: string;
}

interface SelectThreadTransition {
  workspaceId: string;
  threadId: string;
}

interface CreateThreadTransition {
  workspaceId: string;
  threadId: string;
  title: string;
}

const createThreadSummary = (
  threadId: string,
  title: string,
  overrides: Partial<ThreadSummary> = {}
): ThreadSummary => ({
  id: threadId,
  title,
  updatedAt: "now",
  preview: null,
  changeSummary: null,
  state: "idle",
  isRunning: false,
  hasPendingApproval: false,
  hasPendingUserInput: false,
  ...overrides
});

const withCurrentWorkspace = (
  state: WorkspaceState,
  projects: WorkspaceProject[],
  archivedProjects: WorkspaceProject[]
): WorkspaceState => {
  const currentProject = projects.find((project) => project.isCurrent) ?? null;

  return {
    ...state,
    currentWorkspace: currentProject
      ? {
          id: currentProject.id,
          name: currentProject.name,
          path: currentProject.path
        }
      : null,
    currentThreadId: currentProject?.currentThreadId ?? null,
    threads: currentProject?.threads ?? [],
    projects,
    archivedProjects
  };
};

const prependUniqueThread = (threads: ThreadSummary[], thread: ThreadSummary) => [
  thread,
  ...threads.filter((candidate) => candidate.id !== thread.id)
];

const ensureThread = (
  threads: ThreadSummary[],
  threadId: string,
  title: string
): ThreadSummary[] => {
  const existing = threads.find((thread) => thread.id === threadId);

  if (existing) {
    return prependUniqueThread(threads, {
      ...existing,
      title: existing.title || title,
      updatedAt: "now"
    });
  }

  return prependUniqueThread(threads, createThreadSummary(threadId, title));
};

const activateProject = (
  project: WorkspaceProject,
  workspaceId: string,
  threadId: string | null,
  title?: string
): WorkspaceProject =>
  project.id === workspaceId
    ? {
        ...project,
        isCurrent: true,
        currentThreadId: threadId,
        threads: threadId && title ? ensureThread(project.threads, threadId, title) : project.threads
      }
    : {
        ...project,
        isCurrent: false
      };

export const applyArchiveThreadTransition = (
  state: WorkspaceState,
  transition: ArchiveThreadTransition
): WorkspaceState => {
  let archivedThread: ThreadSummary | null = null;

  const projects = state.projects.map((project) => {
    if (project.id !== transition.workspaceId) {
      return project;
    }

    const threads = project.threads.filter((thread) => {
      if (thread.id === transition.threadId) {
        archivedThread = thread;
        return false;
      }

      return true;
    });

    return {
      ...project,
      currentThreadId:
        project.currentThreadId === transition.threadId
          ? transition.nextThreadId
          : project.currentThreadId,
      threads
    };
  });

  if (!archivedThread) {
    return state;
  }

  const archivedThreadSummary = archivedThread;

  const sourceProject =
    projects.find((project) => project.id === transition.workspaceId) ??
    state.projects.find((project) => project.id === transition.workspaceId);

  if (!sourceProject) {
    return state;
  }

  let archivedProjectMatched = false;
  const archivedProjects = state.archivedProjects
    .map((project) => {
      if (project.id !== transition.workspaceId) {
        return project;
      }

      archivedProjectMatched = true;
      return {
        ...project,
        isCurrent: sourceProject.isCurrent,
        currentThreadId: sourceProject.currentThreadId,
        threads: prependUniqueThread(project.threads, archivedThreadSummary)
      };
    })
    .filter((project) => project.threads.length > 0);

  if (!archivedProjectMatched) {
    archivedProjects.push({
      id: sourceProject.id,
      name: sourceProject.name,
      path: sourceProject.path,
      isCurrent: sourceProject.isCurrent,
      currentThreadId: sourceProject.currentThreadId,
      threads: [archivedThreadSummary]
    });
  }

  return withCurrentWorkspace(state, projects, archivedProjects);
};

export const applyUnarchiveThreadTransition = (
  state: WorkspaceState,
  transition: UnarchiveThreadTransition
): WorkspaceState => {
  let restoredThread: ThreadSummary | null = null;

  const archivedProjects = state.archivedProjects
    .map((project) => {
      if (project.id !== transition.workspaceId) {
        return project;
      }

      const threads = project.threads.filter((thread) => {
        if (thread.id === transition.threadId) {
          restoredThread = thread;
          return false;
        }

        return true;
      });

      return {
        ...project,
        threads
      };
    })
    .filter((project) => project.threads.length > 0);

  if (!restoredThread) {
    return state;
  }

  const restoredThreadSummary = restoredThread;

  const projects = state.projects.map((project) =>
    project.id === transition.workspaceId
      ? {
          ...project,
          isCurrent: true,
          currentThreadId: transition.threadId,
          threads: prependUniqueThread(project.threads, restoredThreadSummary)
        }
      : {
          ...project,
          isCurrent: false
        }
  );

  return withCurrentWorkspace(state, projects, archivedProjects);
};

export const applySelectThreadTransition = (
  state: WorkspaceState,
  transition: SelectThreadTransition
): WorkspaceState => {
  const projects = state.projects.map((project) =>
    activateProject(project, transition.workspaceId, transition.threadId)
  );

  return withCurrentWorkspace(state, projects, state.archivedProjects);
};

export const applyCreateThreadTransition = (
  state: WorkspaceState,
  transition: CreateThreadTransition
): WorkspaceState => {
  const projects = state.projects.map((project) =>
    activateProject(project, transition.workspaceId, transition.threadId, transition.title)
  );

  return withCurrentWorkspace(state, projects, state.archivedProjects);
};
