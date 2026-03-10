// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppBridge, RealtimeState, VoicePreferences } from "@shared";
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

function Harness() {
  useRealtimeVoice({ enabled: false });
  return <div>voice hook probe</div>;
}

describe("useRealtimeVoice", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let stopRealtime: ReturnType<typeof vi.fn<() => Promise<RealtimeState>>>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    stopRealtime = vi.fn<() => Promise<RealtimeState>>().mockResolvedValue(realtimeState);

    const mediaDevices = {
      enumerateDevices: vi.fn().mockResolvedValue([]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: mediaDevices
    });

    Object.defineProperty(window, "appBridge", {
      configurable: true,
      value: {
        getAppInfo: vi.fn(),
        getSessionState: vi.fn(),
        getWorkspaceState: vi.fn(),
        openWorkspace: vi.fn(),
        openCurrentWorkspace: vi.fn(),
        selectWorkspace: vi.fn(),
        selectThread: vi.fn(),
        getTimelineState: vi.fn(),
        getWorkerSettingsState: vi.fn(),
        updateWorkerSettings: vi.fn(),
        pickWorkerAttachments: vi.fn(),
        startTurn: vi.fn(),
        dispatchVoicePrompt: vi.fn(),
        interruptActiveTurn: vi.fn(),
        respondToApproval: vi.fn(),
        submitUserInput: vi.fn(),
        getRealtimeState: vi.fn().mockResolvedValue(realtimeState),
        startRealtime: vi.fn().mockResolvedValue(realtimeState),
        stopRealtime,
        appendRealtimeAudio: vi.fn(),
        appendRealtimeText: vi.fn(),
        getVoicePreferences: vi.fn().mockResolvedValue(voicePreferences),
        updateVoicePreferences: vi.fn().mockResolvedValue(voicePreferences),
        subscribeRealtimeEvents: vi.fn().mockReturnValue(() => undefined)
      } satisfies AppBridge
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
});
