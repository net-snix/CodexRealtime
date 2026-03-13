// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeState, VoiceIntent, VoicePreferences } from "@shared";
import type { NativeApi } from "./native-api";
import { useRealtimeVoice } from "./use-realtime-voice";

const realtimeState: RealtimeState = {
  status: "idle",
  threadId: null,
  sessionId: null,
  error: null
};

const voicePreferences: VoicePreferences = {
  selectedInputDeviceId: "",
  selectedOutputDeviceId: "",
  deviceHintDismissed: false,
  deviceSetupComplete: false
};

type HookState = ReturnType<typeof useRealtimeVoice>;
type RealtimeEventHandler = Parameters<NativeApi["subscribeRealtimeEvents"]>[0];
type MockAudioProcessEvent = {
  inputBuffer: {
    getChannelData: (channel: number) => Float32Array;
  };
};

let latestHook: HookState | null = null;

function Harness({
  enabled = false,
  onVoiceIntent
}: {
  enabled?: boolean;
  onVoiceIntent?: (intent: VoiceIntent) => void | Promise<void>;
}) {
  latestHook = useRealtimeVoice({ enabled, onVoiceIntent });
  return <div>voice hook probe</div>;
}

describe("useRealtimeVoice", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let startRealtime: ReturnType<typeof vi.fn<() => Promise<RealtimeState>>>;
  let stopRealtime: ReturnType<typeof vi.fn<() => Promise<RealtimeState>>>;
  let appendRealtimeAudio: ReturnType<typeof vi.fn<(chunk: unknown) => Promise<void>>>;
  let getUserMedia: ReturnType<typeof vi.fn<() => Promise<MediaStream>>>;
  let realtimeEventHandler: RealtimeEventHandler | null = null;
  let lastProcessor: {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    onaudioprocess: ((event: MockAudioProcessEvent) => void) | null;
  } | null = null;
  let trackStop: ReturnType<typeof vi.fn>;
  let createBuffer: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    startRealtime = vi.fn<() => Promise<RealtimeState>>().mockResolvedValue(realtimeState);
    stopRealtime = vi.fn<() => Promise<RealtimeState>>().mockResolvedValue(realtimeState);
    appendRealtimeAudio = vi
      .fn<(chunk: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);
    createBuffer = vi.fn(
      () =>
        ({
          copyToChannel: vi.fn(),
          duration: 0.01
        }) as unknown as AudioBuffer
    );
    trackStop = vi.fn();
    getUserMedia = vi.fn<() => Promise<MediaStream>>().mockResolvedValue({
      getTracks: () => [{ stop: trackStop }]
    } as unknown as MediaStream);

    const sourceNode = {
      connect: vi.fn(),
      disconnect: vi.fn()
    };

    const mediaDevices = {
      enumerateDevices: vi.fn().mockResolvedValue([]),
      getUserMedia,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: mediaDevices
    });

    class MockAudioContext {
      sampleRate = 24_000;
      state: AudioContextState = "running";
      destination = {} as AudioDestinationNode;
      currentTime = 0;

      createMediaStreamSource() {
        return sourceNode as unknown as MediaStreamAudioSourceNode;
      }

      createScriptProcessor() {
        lastProcessor = {
          connect: vi.fn(),
          disconnect: vi.fn(),
          onaudioprocess: null
        };
        return lastProcessor as unknown as ScriptProcessorNode;
      }

      createMediaStreamDestination() {
        return {
          stream: {} as MediaStream
        } as MediaStreamAudioDestinationNode;
      }

      createBuffer = createBuffer;

      createBufferSource() {
        return {
          connect: vi.fn(),
          start: vi.fn(),
          buffer: null as AudioBuffer | null
        } as unknown as AudioBufferSourceNode;
      }

      resume = vi.fn(async () => undefined);

      close = vi.fn(async () => {
        this.state = "closed";
      });
    }

    Object.defineProperty(globalThis, "AudioContext", {
      configurable: true,
      value: MockAudioContext
    });
    Object.defineProperty(globalThis, "Audio", {
      configurable: true,
      value: class MockAudioElement {
        autoplay = false;
        srcObject: MediaStream | null = null;
        play = vi.fn(async () => undefined);
        pause = vi.fn();
      }
    });

    Object.defineProperty(window, "nativeApi", {
      configurable: true,
      value: {
        getAppInfo: vi.fn(),
        getAppSettingsState: vi.fn(),
        updateAppSettings: vi.fn(),
        showDesktopNotification: vi.fn(),
        openUserDataDirectory: vi.fn(),
        openInEditor: vi.fn(),
        getSessionState: vi.fn(),
        getWorkspaceState: vi.fn(),
        openWorkspace: vi.fn(),
        openCurrentWorkspace: vi.fn(),
        clearRecentWorkspaces: vi.fn(),
        removeWorkspace: vi.fn(),
        selectWorkspace: vi.fn(),
        createThread: vi.fn(),
        selectThread: vi.fn(),
        archiveThread: vi.fn(),
        unarchiveThread: vi.fn(),
        getTimelineState: vi.fn(),
        getWorkerSettingsState: vi.fn(),
        updateWorkerSettings: vi.fn(),
        pickWorkerAttachments: vi.fn(),
        addWorkerAttachments: vi.fn(),
        addPastedImageAttachments: vi.fn(),
        startTurn: vi.fn(),
        dispatchVoiceIntent: vi.fn(),
        interruptActiveTurn: vi.fn(),
        respondToApproval: vi.fn(),
        submitUserInput: vi.fn(),
        getRealtimeState: vi.fn().mockResolvedValue(realtimeState),
        startRealtime,
        stopRealtime,
        appendRealtimeAudio,
        appendRealtimeText: vi.fn(),
        getVoicePreferences: vi.fn().mockResolvedValue(voicePreferences),
        updateVoicePreferences: vi.fn().mockResolvedValue(voicePreferences),
        resetVoicePreferences: vi.fn().mockResolvedValue(voicePreferences),
        subscribeRealtimeEvents: vi.fn().mockImplementation((handler) => {
          realtimeEventHandler = handler;
          return () => {
            realtimeEventHandler = null;
          };
        }),
        subscribeTimelineUpdates: vi.fn(() => () => {})
      } satisfies NativeApi
    });

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

    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    container?.remove();
    container = null;
    root = null;
    latestHook = null;
    realtimeEventHandler = null;
    lastProcessor = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not stop realtime during strict-mode startup", async () => {
    await act(async () => {
      root?.render(
        <StrictMode>
          <Harness />
        </StrictMode>
      );

      await Promise.resolve();
      await Promise.resolve();
    });

    expect(stopRealtime).not.toHaveBeenCalled();
  });

  it("bounds queued audio sends while one chunk is in flight", async () => {
    const pendingResolvers: Array<() => void> = [];
    appendRealtimeAudio.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          pendingResolvers.push(resolve);
        })
    );

    await act(async () => {
      root?.render(<Harness enabled />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latestHook).not.toBeNull();

    await act(async () => {
      await latestHook?.start();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(startRealtime).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(lastProcessor?.onaudioprocess).toBeTypeOf("function");

    await act(async () => {
      for (let index = 0; index < 6; index += 1) {
        lastProcessor?.onaudioprocess?.({
          inputBuffer: {
            getChannelData: () => new Float32Array([index / 10, index / 20, index / 30])
          }
        });
      }
      await Promise.resolve();
    });

    expect(appendRealtimeAudio).toHaveBeenCalledTimes(1);

    for (let index = 0; index < 5; index += 1) {
      await act(async () => {
        pendingResolvers.shift()?.();
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    expect(appendRealtimeAudio).toHaveBeenCalledTimes(5);
  });

  it("clears queued audio when stopping with a send still in flight", async () => {
    let resolveFirstChunk: (() => void) | null = null;
    appendRealtimeAudio.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveFirstChunk = resolve;
        })
    );

    await act(async () => {
      root?.render(<Harness enabled />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await latestHook?.start();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      for (let index = 0; index < 3; index += 1) {
        lastProcessor?.onaudioprocess?.({
          inputBuffer: {
            getChannelData: () => new Float32Array([index / 10, index / 20])
          }
        });
      }
      await Promise.resolve();
    });

    expect(appendRealtimeAudio).toHaveBeenCalledTimes(1);

    await act(async () => {
      await latestHook?.stop();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      resolveFirstChunk?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(appendRealtimeAudio).toHaveBeenCalledTimes(1);
    expect(stopRealtime).toHaveBeenCalledTimes(1);
    expect(trackStop).toHaveBeenCalledTimes(1);
  });

  it("deduplicates repeated transcript text fragments", async () => {
    await act(async () => {
      root?.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(realtimeEventHandler).not.toBeNull();

    await act(async () => {
      realtimeEventHandler?.({
        type: "item",
        item: {
          type: "message",
          id: "user-1",
          role: "user",
          status: "completed",
          text: "hello",
          transcript: "hello",
          content: [
            { type: "input_text", text: "hello" },
            { type: "input_text", text: "world" }
          ]
        }
      });
      await Promise.resolve();
    });

    expect(latestHook?.liveTranscript).toEqual([
      expect.objectContaining({
        id: "item:user-1",
        speaker: "user",
        text: "hello\nworld"
      })
    ]);
  });

  it("dispatches structured work requests for repo-work user transcripts", async () => {
    const onVoiceIntent = vi.fn();

    await act(async () => {
      root?.render(<Harness onVoiceIntent={onVoiceIntent} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(realtimeEventHandler).not.toBeNull();

    await act(async () => {
      realtimeEventHandler?.({
        type: "item",
        item: {
          type: "message",
          id: "user-work-1",
          role: "user",
          status: "completed",
          text: "Inspect src/App.tsx and fix the failing test"
        }
      });
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    expect(onVoiceIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "work_request",
        source: expect.objectContaining({
          sourceType: "message",
          itemId: "user-work-1",
          transcript: "Inspect src/App.tsx and fix the failing test"
        }),
        taskEnvelope: expect.objectContaining({
          userGoal: "Inspect src/App.tsx and fix the failing test",
          distilledPrompt: "Inspect src/App.tsx and fix the failing test",
          clarificationPolicy: "request_user_input"
        })
      })
    );
  });

  it("upgrades a matching message into a handoff transcript without redispatching work", async () => {
    vi.useFakeTimers();
    const onVoiceIntent = vi.fn();

    await act(async () => {
      root?.render(<Harness onVoiceIntent={onVoiceIntent} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(realtimeEventHandler).not.toBeNull();

    await act(async () => {
      realtimeEventHandler?.({
        type: "item",
        item: {
          type: "message",
          id: "user-work-2",
          role: "user",
          status: "completed",
          text: "Inspect src/App.tsx and fix the failing test"
        }
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onVoiceIntent).toHaveBeenCalledTimes(0);

    await act(async () => {
      realtimeEventHandler?.({
        type: "item",
        item: {
          type: "handoff_request",
          handoff_id: "handoff-1",
          input_transcript: "Inspect src/App.tsx and fix the failing test",
          messages: [{ text: "Inspect src/App.tsx and fix the failing test" }],
          target: "codex"
        }
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onVoiceIntent).toHaveBeenCalledTimes(1);
    expect(latestHook?.liveTranscript).toEqual([
      expect.objectContaining({
        id: "handoff:handoff-1",
        speaker: "user",
        text: "Inspect src/App.tsx and fix the failing test"
      })
    ]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(onVoiceIntent).toHaveBeenCalledTimes(1);
  });

  it("preserves handoff metadata when dispatching structured voice intents", async () => {
    const onVoiceIntent = vi.fn();

    await act(async () => {
      root?.render(<Harness onVoiceIntent={onVoiceIntent} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(realtimeEventHandler).not.toBeNull();

    await act(async () => {
      realtimeEventHandler?.({
        type: "item",
        item: {
          type: "handoff_request",
          handoff_id: "handoff-2",
          messages: [{ text: "Run pnpm test and inspect failing specs" }],
          target: "codex",
          request: {
            kind: "tool"
          }
        }
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onVoiceIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "work_request",
        source: expect.objectContaining({
          sourceType: "handoff_request",
          handoffId: "handoff-2",
          transcript: "Run pnpm test and inspect failing specs",
          metadata: expect.objectContaining({
            target: "codex",
            request: expect.objectContaining({
              kind: "tool"
            })
          })
        }),
        taskEnvelope: expect.objectContaining({
          source: "handoff_request",
          handoffId: "handoff-2",
          sourceMessageIds: []
        })
      })
    );
  });

  it("suppresses a late plain-message downgrade after a handoff already dispatched", async () => {
    vi.useFakeTimers();
    const onVoiceIntent = vi.fn();

    await act(async () => {
      root?.render(<Harness onVoiceIntent={onVoiceIntent} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      realtimeEventHandler?.({
        type: "item",
        item: {
          type: "handoff_request",
          handoff_id: "handoff-3",
          input_transcript: "Inspect src/App.tsx and fix the failing test",
          messages: [{ id: "user-work-3", text: "Inspect src/App.tsx and fix the failing test" }]
        }
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onVoiceIntent).toHaveBeenCalledTimes(1);

    await act(async () => {
      realtimeEventHandler?.({
        type: "item",
        item: {
          type: "message",
          id: "user-work-3",
          role: "user",
          status: "completed",
          text: "Inspect src/App.tsx"
        }
      });
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(onVoiceIntent).toHaveBeenCalledTimes(1);
    expect(latestHook?.liveTranscript).toEqual([
      expect.objectContaining({
        id: "handoff:handoff-3",
        text: "Inspect src/App.tsx and fix the failing test"
      })
    ]);
  });

  it("ignores handoff requests that never produce transcript text", async () => {
    const onVoiceIntent = vi.fn();

    await act(async () => {
      root?.render(<Harness onVoiceIntent={onVoiceIntent} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      realtimeEventHandler?.({
        type: "item",
        item: {
          type: "handoff_request",
          handoff_id: "handoff-empty",
          messages: [{ id: "user-empty-1" }]
        }
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onVoiceIntent).not.toHaveBeenCalled();
    expect(latestHook?.liveTranscript).toEqual([]);
  });

  it("ignores malformed realtime audio chunks", async () => {
    await act(async () => {
      root?.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(realtimeEventHandler).not.toBeNull();

    await act(async () => {
      realtimeEventHandler?.({
        type: "audio",
        audio: {
          data: btoa("\u0001\u0002"),
          sampleRate: 24_000,
          numChannels: 99,
          samplesPerChannel: 1
        }
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createBuffer).not.toHaveBeenCalled();
    expect(latestHook?.voiceState).toBe("idle");
  });
});
