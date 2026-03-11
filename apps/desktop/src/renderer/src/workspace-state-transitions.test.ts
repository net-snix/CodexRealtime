import { describe, expect, it } from "vitest";
import type { ThreadSummary, WorkspaceState } from "@shared";
import {
  applyArchiveThreadTransition,
  applyCreateThreadTransition,
  applySelectThreadTransition,
  applyUnarchiveThreadTransition
} from "./workspace-state-transitions";

const makeThreadSummary = (overrides: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id: "thread-1",
  title: "Thread",
  updatedAt: "now",
  preview: null,
  changeSummary: null,
  state: "idle",
  isRunning: false,
  hasPendingApproval: false,
  hasPendingUserInput: false,
  ...overrides
});

const baseState: WorkspaceState = {
  currentWorkspace: {
    id: "workspace-1",
    name: "AskInLine",
    path: "/tmp/AskInLine"
  },
  currentThreadId: "thread-1",
  recentWorkspaces: [],
  threads: [
    makeThreadSummary({ id: "thread-1", title: "Current thread" }),
    makeThreadSummary({ id: "thread-2", title: "Next thread", updatedAt: "1m" })
  ],
  projects: [
    {
      id: "workspace-1",
      name: "AskInLine",
      path: "/tmp/AskInLine",
      isCurrent: true,
      currentThreadId: "thread-1",
      threads: [
        makeThreadSummary({ id: "thread-1", title: "Current thread" }),
        makeThreadSummary({ id: "thread-2", title: "Next thread", updatedAt: "1m" })
      ]
    },
    {
      id: "workspace-2",
      name: "CodexRealtime",
      path: "/tmp/CodexRealtime",
      isCurrent: false,
      currentThreadId: "thread-3",
      threads: [makeThreadSummary({ id: "thread-3", title: "Other thread", updatedAt: "2m" })]
    }
  ],
  archivedProjects: []
};

describe("applyArchiveThreadTransition", () => {
  it("moves the current thread into archived and selects the next thread", () => {
    const nextState = applyArchiveThreadTransition(baseState, {
      workspaceId: "workspace-1",
      threadId: "thread-1",
      nextThreadId: "thread-2"
    });

    expect(nextState.currentThreadId).toBe("thread-2");
    expect(nextState.threads.map((thread) => thread.id)).toEqual(["thread-2"]);
    expect(nextState.projects[0]?.currentThreadId).toBe("thread-2");
    expect(nextState.projects[0]?.threads.map((thread) => thread.id)).toEqual(["thread-2"]);
    expect(nextState.archivedProjects[0]?.threads.map((thread) => thread.id)).toEqual(["thread-1"]);
  });

  it("archives a non-current thread without switching the active view", () => {
    const nextState = applyArchiveThreadTransition(baseState, {
      workspaceId: "workspace-2",
      threadId: "thread-3",
      nextThreadId: null
    });

    expect(nextState.currentThreadId).toBe("thread-1");
    expect(nextState.projects[0]?.currentThreadId).toBe("thread-1");
    expect(nextState.projects[1]?.threads).toEqual([]);
    expect(nextState.archivedProjects[0]?.id).toBe("workspace-2");
    expect(nextState.archivedProjects[0]?.threads.map((thread) => thread.id)).toEqual(["thread-3"]);
  });
});

describe("applyUnarchiveThreadTransition", () => {
  it("restores the thread and makes its project active", () => {
    const archivedState = applyArchiveThreadTransition(baseState, {
      workspaceId: "workspace-2",
      threadId: "thread-3",
      nextThreadId: null
    });

    const nextState = applyUnarchiveThreadTransition(archivedState, {
      workspaceId: "workspace-2",
      threadId: "thread-3"
    });

    expect(nextState.currentWorkspace?.id).toBe("workspace-2");
    expect(nextState.currentThreadId).toBe("thread-3");
    expect(nextState.projects[0]?.isCurrent).toBe(false);
    expect(nextState.projects[1]?.isCurrent).toBe(true);
    expect(nextState.projects[1]?.threads.map((thread) => thread.id)).toEqual(["thread-3"]);
    expect(nextState.archivedProjects).toEqual([]);
  });
});

describe("applySelectThreadTransition", () => {
  it("marks the selected thread active without rebuilding workspace state", () => {
    const nextState = applySelectThreadTransition(baseState, {
      workspaceId: "workspace-1",
      threadId: "thread-2"
    });

    expect(nextState.currentWorkspace?.id).toBe("workspace-1");
    expect(nextState.currentThreadId).toBe("thread-2");
    expect(nextState.projects[0]?.currentThreadId).toBe("thread-2");
    expect(nextState.projects[0]?.threads.map((thread) => thread.id)).toEqual([
      "thread-1",
      "thread-2"
    ]);
  });
});

describe("applyCreateThreadTransition", () => {
  it("adds a new draft thread to the active workspace", () => {
    const nextState = applyCreateThreadTransition(baseState, {
      workspaceId: "workspace-1",
      threadId: "thread-9",
      title: "New thread"
    });

    expect(nextState.currentWorkspace?.id).toBe("workspace-1");
    expect(nextState.currentThreadId).toBe("thread-9");
    expect(nextState.projects[0]?.threads[0]).toEqual({
      id: "thread-9",
      title: "New thread",
      updatedAt: "now",
      preview: null,
      changeSummary: null,
      state: "idle",
      isRunning: false,
      hasPendingApproval: false,
      hasPendingUserInput: false
    });
  });
});
