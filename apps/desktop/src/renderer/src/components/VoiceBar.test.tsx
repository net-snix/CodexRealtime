// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioDeviceOption, RealtimeState, SessionState, VoiceApiKeyState } from "@shared";
import { VoiceBar } from "./VoiceBar";

const sessionState: SessionState = {
  status: "connected",
  account: {
    type: "chatgpt",
    planType: "pro"
  },
  features: {
    defaultModeRequestUserInput: true,
    realtimeConversation: true,
    voiceTranscription: true
  },
  error: null,
  lastUpdatedAt: "2026-03-11T20:20:00.000Z",
  requiresOpenaiAuth: false
};

const apiKeySessionState: SessionState = {
  ...sessionState,
  account: {
    type: "apiKey"
  }
};

const realtimeState: RealtimeState = {
  status: "idle",
  threadId: null,
  sessionId: null,
  error: null
};
const validVoiceApiKeyState: VoiceApiKeyState = {
  configured: true,
  status: "valid",
  lastValidatedAt: "2026-03-14T10:00:00.000Z",
  error: null
};

const devices: AudioDeviceOption[] = [
  { id: "", label: "Default" },
  { id: "built-in", label: "Built-in Mic" }
];

describe("VoiceBar", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
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

    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("closes the device picker when the controlled panel closes", async () => {
    const renderVoiceBar = async (isOpen: boolean) => {
      await act(async () => {
        root?.render(
          <VoiceBar
            isOpen={isOpen}
            sessionState={apiKeySessionState}
            voiceMode="transcription"
            voiceApiKeyState={validVoiceApiKeyState}
            state="idle"
            realtimeState={realtimeState}
            disabled={false}
            isActive={false}
            isStopping={false}
            feedback={null}
            canStop={false}
            liveTranscript={[]}
            inputDevices={devices}
            outputDevices={devices}
            selectedInputDeviceId=""
            selectedOutputDeviceId=""
            supportsOutputSelection={true}
            shouldShowDeviceHint={false}
            onDismissDeviceHint={vi.fn()}
            onInputDeviceChange={vi.fn()}
            onOutputDeviceChange={vi.fn()}
            onToggle={vi.fn()}
            onStop={vi.fn()}
          />
        );
      });
    };

    await renderVoiceBar(false);

    expect(container?.querySelector(".voice-bar-collapsed")).not.toBeNull();
    expect(container?.querySelector(".voice-device-panel")).toBeNull();

    await renderVoiceBar(true);

    expect(container?.textContent).toContain("Voice agent ready.");

    const devicesButton = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Devices"
    );

    await act(async () => {
      devicesButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container?.querySelector(".voice-device-panel")).not.toBeNull();

    await renderVoiceBar(false);

    expect(container?.querySelector(".voice-bar-collapsed")).not.toBeNull();
    expect(container?.querySelector(".voice-device-panel")).toBeNull();
    expect(container?.textContent).not.toContain("State");
  });

  it("explains that realtime voice needs a valid OpenAI API key", async () => {
    await act(async () => {
      root?.render(
        <VoiceBar
          isOpen={true}
          sessionState={sessionState}
          voiceMode="realtime"
          voiceApiKeyState={{
            configured: false,
            status: "missing",
            lastValidatedAt: null,
            error: null
          }}
          state="idle"
          realtimeState={realtimeState}
          disabled={true}
          isActive={false}
          isStopping={false}
          feedback={null}
          canStop={false}
          liveTranscript={[]}
          inputDevices={devices}
          outputDevices={devices}
          selectedInputDeviceId=""
          selectedOutputDeviceId=""
          supportsOutputSelection={true}
          shouldShowDeviceHint={false}
          onDismissDeviceHint={vi.fn()}
          onInputDeviceChange={vi.fn()}
          onOutputDeviceChange={vi.fn()}
          onToggle={vi.fn()}
          onStop={vi.fn()}
        />
      );
    });

    expect(container?.textContent).toContain("Realtime voice requires a valid OpenAI API key.");
  });
});
