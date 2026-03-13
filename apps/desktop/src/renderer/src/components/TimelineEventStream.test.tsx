// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineEntry } from "@shared";

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
    await act(async () => {
      root?.render(
        <TimelineEventStream
          entries={[assistantMessageEntry]}
          isWorkingLogMode={false}
          isRunning
          isResolvingRequests={false}
          activeWorkingLabel="Working"
          latestWorkingStatus="Working"
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
});
