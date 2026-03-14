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
  mode: "transcription",
  speakAgentActivity: true,
  speakToolCalls: true,
  speakPlanUpdates: true,
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
  let realtimeEventHandler: RealtimeEventHandler | null = null;
  let getUserMedia: ReturnType<typeof vi.fn<() => Promise<MediaStream>>>;
  let trackStop: ReturnType<typeof vi.fn>;
  let createBuffer: ReturnType<typeof vi.fn>;
  let lastProcessor: {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    onaudioprocess: ((event: MockAudioProcessEvent) => void) | null;
  } | null = null;
  let lastPlaybackElement: {
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
  } | null = null;

  const renderHarness = async ({
    enabled = false,
    onVoiceIntent
  }: {
    enabled?: boolean;
    onVoiceIntent?: (intent: VoiceIntent) => void | Promise<void>;
  } = {}) => {
    await act(async () => {
      root?.render(<Harness enabled={enabled} onVoiceIntent={onVoiceIntent} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latestHook).not.toBeNull();
  };

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

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([]),
        getUserMedia,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }
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

        constructor() {
          lastPlaybackElement = {
            play: this.play,
            pause: this.pause
          };
        }
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
        getVoiceApiKeyState: vi.fn().mockResolvedValue({
          configured: false,
          status: "missing",
          lastValidatedAt: null,
          error: null
        }),
        setVoiceApiKey: vi.fn(),
        clearVoiceApiKey: vi.fn(),
        testVoiceApiKey: vi.fn(),
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
    lastPlaybackElement = null;
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

    await renderHarness({ enabled: true });

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

  it("keeps playback alive until realtime stop finishes", async () => {
    let resolveStop: (() => void) | null = null;
    stopRealtime.mockImplementation(
      () =>
        new Promise<RealtimeState>((resolve) => {
          resolveStop = () => resolve(realtimeState);
        })
    );

    await renderHarness({ enabled: true });

    await act(async () => {
      await latestHook?.start();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      realtimeEventHandler?.({
        type: "audio",
        audio: {
          data: btoa("\u0000\u0000"),
          sampleRate: 24_000,
          numChannels: 1,
          samplesPerChannel: 1
        }
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    let stopPromise: Promise<void> | undefined;
    await act(async () => {
      stopPromise = latestHook?.stop();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(stopRealtime).toHaveBeenCalledTimes(1);
    expect(lastPlaybackElement?.pause).not.toHaveBeenCalled();

    await act(async () => {
      resolveStop?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    await stopPromise;

    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(lastPlaybackElement?.pause).toHaveBeenCalledTimes(1);
  });

  it("dispatches voice intents from transcript events until main marks them handled", async () => {
    const onVoiceIntent = vi.fn();

    await renderHarness({ onVoiceIntent });

    await act(async () => {
      realtimeEventHandler?.({
        type: "transcript",
        intentHandled: false,
        entry: {
          id: "assistant-1",
          speaker: "assistant",
          text: "Handing this to Codex now.",
          status: "final",
          createdAt: "10:11"
        }
      });
      realtimeEventHandler?.({
        type: "transcript",
        intentHandled: false,
        entry: {
          id: "transcript-1",
          speaker: "user",
          text: "Inspect src/App.tsx and fix the failing test",
          status: "final",
          createdAt: "10:12"
        }
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onVoiceIntent).toHaveBeenCalledTimes(1);
    expect(latestHook?.liveTranscript).toEqual([
      expect.objectContaining({
        id: "assistant-1",
        text: "Handing this to Codex now."
      }),
      expect.objectContaining({
        id: "transcript-1",
        text: "Inspect src/App.tsx and fix the failing test"
      })
    ]);
    expect(onVoiceIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "work_request"
      })
    );

    await act(async () => {
      realtimeEventHandler?.({
        type: "transcript",
        intentHandled: true,
        entry: {
          id: "transcript-1",
          speaker: "user",
          text: "Inspect src/App.tsx and fix the failing test",
          status: "final",
          createdAt: "10:13"
        }
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onVoiceIntent).toHaveBeenCalledTimes(1);
  });

  it("ignores malformed realtime audio chunks", async () => {
    await renderHarness();

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
