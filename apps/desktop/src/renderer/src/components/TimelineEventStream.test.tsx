// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineEntry } from "@shared";
import { buildPresentedTimeline } from "../timeline-event-stream";

const richTextRenderSpy = vi.fn();

vi.mock("./TimelineRichText", () => ({
  TimelineRichText: ({
    text,
    className
  }: {
    text: string;
    className?: string;
  }) => {
    richTextRenderSpy();
    return <div className={className}>{text}</div>;
  }
}));

import { TimelineEventStream } from "./TimelineEventStream";

const assistantMessageEntry: TimelineEntry = {
  id: "entry-1",
  kind: "message",
  role: "assistant",
  text: "Hello from the worker",
  createdAt: "2026-03-13T20:00:00.000Z",
  completedAt: null,
  turnId: "turn-1",
  summary: null,
  isStreaming: false,
  providerLabel: null
};

const makeCommandEntry = (
  entry: Partial<Extract<TimelineEntry, { kind: "activity" }>>
): TimelineEntry =>
  ({
    id: "command-1",
    kind: "activity",
    activityType: "command_execution",
    createdAt: "2026-03-13T20:00:00.000Z",
    turnId: "turn-1",
    tone: "tool",
    label: "Ran pwd",
    detail: "/Users/espenmac/Code/CodexRealtime",
    command: "pwd",
    changedFiles: [],
    status: "completed",
    toolName: null,
    agentLabel: null,
    ...entry
  }) as TimelineEntry;

describe("TimelineEventStream", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-13T20:00:00.000Z"));
    richTextRenderSpy.mockClear();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }

    vi.useRealTimers();
    root = null;
    container?.remove();
    container = null;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("updates the working timer without re-rendering timeline message rows", async () => {
    const entries = [assistantMessageEntry];

    await act(async () => {
      root?.render(
        <TimelineEventStream
          entries={entries}
          presentedTimeline={buildPresentedTimeline(entries, false)}
          isWorkingLogMode={false}
          isRunning
          isResolvingRequests={false}
          activeWorkingLabel="Working"
          activeWorkStartedAt="2026-03-13T20:00:00.000Z"
          streamRef={{ current: null }}
        />
      );
    });

    expect(container?.textContent).toContain("Working for 0s");
    expect(richTextRenderSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(container?.textContent).toContain("Working for 2s");
    expect(richTextRenderSpy).toHaveBeenCalledTimes(1);
  });

  it("skips re-rendering message rows when a parent re-renders with the same stream props", async () => {
    const entries = [assistantMessageEntry];
    const streamRef = { current: null };
    const presentedTimeline = buildPresentedTimeline(entries, false);

    await act(async () => {
      root?.render(
        <div>
          <span data-parent-version="1">parent one</span>
          <TimelineEventStream
            entries={entries}
            presentedTimeline={presentedTimeline}
            isWorkingLogMode={false}
            isRunning={false}
            isResolvingRequests={false}
            activeWorkingLabel="Working"
            activeWorkStartedAt={null}
            streamRef={streamRef}
          />
        </div>
      );
    });

    expect(richTextRenderSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      root?.render(
        <div>
          <span data-parent-version="2">parent two</span>
          <TimelineEventStream
            entries={entries}
            presentedTimeline={presentedTimeline}
            isWorkingLogMode={false}
            isRunning={false}
            isResolvingRequests={false}
            activeWorkingLabel="Working"
            activeWorkStartedAt={null}
            streamRef={streamRef}
          />
        </div>
      );
    });

    expect(richTextRenderSpy).toHaveBeenCalledTimes(1);
  });

  it("clusters consecutive command rows into a compact command summary", async () => {
    const entries = [
      makeCommandEntry({
        id: "command-1",
        label: "Ran command",
        command: "pwd",
        detail: "/Users/espenmac/Code/CodexRealtime"
      }),
      makeCommandEntry({
        id: "command-2",
        label: "Ran command",
        command: "ls",
        detail: "AGENTS.md\napps\npackages",
      })
    ];

    await act(async () => {
      root?.render(
        <TimelineEventStream
          entries={entries}
          presentedTimeline={buildPresentedTimeline(entries, false)}
          isWorkingLogMode={false}
          isRunning={false}
          isResolvingRequests={false}
          activeWorkingLabel="Working"
          activeWorkStartedAt={null}
          streamRef={{ current: null }}
        />
      );
    });

    const cluster = container?.querySelector<HTMLDetailsElement>(".timeline-command-cluster");
    const nestedItems = container?.querySelectorAll(".timeline-command-cluster-item");
    const nestedBadges = container?.querySelectorAll(
      ".timeline-command-cluster-item .timeline-activity-badge"
    );
    const commandCopies = Array.from(
      container?.querySelectorAll(".timeline-command-cluster-item .timeline-activity-copy-code") ?? []
    ).map((node) => node.textContent);
    const commandOutputs = container?.querySelectorAll(".timeline-command-cluster-item .timeline-activity-output");

    expect(cluster?.textContent).toContain("2 commands");
    expect(nestedItems).toHaveLength(2);
    expect(nestedBadges).toHaveLength(0);
    expect(commandCopies).toEqual(["Ran pwd", "Ran ls"]);
    expect(commandOutputs).toHaveLength(0);
    expect(container?.textContent).not.toContain("AGENTS.md");
    expect(richTextRenderSpy).not.toHaveBeenCalled();
  });

  it("shows only the latest six command rows inside an overflow cluster", async () => {
    const entries = Array.from({ length: 7 }, (_, index) =>
      makeCommandEntry({
        id: `command-${index + 1}`,
        label: "Ran command",
        detail: `output ${index + 1}`,
        command: `command-${index + 1}`
      })
    );

    await act(async () => {
      root?.render(
        <TimelineEventStream
          entries={entries}
          presentedTimeline={buildPresentedTimeline(entries, false)}
          isWorkingLogMode={false}
          isRunning={false}
          isResolvingRequests={false}
          activeWorkingLabel="Working"
          activeWorkStartedAt={null}
          streamRef={{ current: null }}
        />
      );
    });

    const cluster = container?.querySelector<HTMLDetailsElement>(".timeline-command-cluster");
    const nestedItems = container?.querySelectorAll(".timeline-command-cluster-item");

    expect(cluster?.textContent).toContain("7 commands");
    expect(container?.textContent).toContain("Showing latest 6 items");
    expect(nestedItems).toHaveLength(6);
    expect(container?.textContent).not.toContain("output 1");
    expect(container?.textContent).toContain("Ran command-7");
  });

  it("separates work logs from the final assistant answer with a worked-for divider", async () => {
    const entries = [
      makeCommandEntry({
        id: "command-1",
        createdAt: "2026-03-13T20:00:00.000Z",
        label: "Ran command",
        command: "pwd",
        detail: "/Users/espenmac/Code/CodexRealtime"
      }),
      {
        ...assistantMessageEntry,
        id: "entry-2",
        createdAt: "2026-03-13T20:00:07.000Z",
        completedAt: "2026-03-13T20:00:07.000Z"
      } satisfies TimelineEntry
    ];

    await act(async () => {
      root?.render(
        <TimelineEventStream
          entries={entries}
          presentedTimeline={buildPresentedTimeline(entries, false)}
          isWorkingLogMode={false}
          isRunning={false}
          isResolvingRequests={false}
          activeWorkingLabel="Working"
          activeWorkStartedAt={null}
          streamRef={{ current: null }}
        />
      );
    });

    const divider = container?.querySelector(".timeline-worked-divider");

    expect(divider?.textContent).toContain("Worked for 0m 7s");
    expect(container?.textContent).toContain("Hello from the worker");
  });
});
