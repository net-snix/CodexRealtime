// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioDeviceOption, RealtimeState, SessionState } from "@shared";
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

const realtimeState: RealtimeState = {
  status: "idle",
  threadId: null,
  sessionId: null,
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

  it("collapses the voice bar and closes the device picker", async () => {
    await act(async () => {
      root?.render(
        <VoiceBar
          sessionState={sessionState}
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

    const devicesButton = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Devices"
    );
    const collapseButton = container?.querySelector(
      'button[aria-label="Hide voice bar"]'
    ) as HTMLButtonElement | null;

    await act(async () => {
      devicesButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container?.querySelector(".voice-device-panel")).not.toBeNull();

    await act(async () => {
      collapseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container?.querySelector(".voice-bar-collapsed")).not.toBeNull();
    expect(container?.querySelector(".voice-device-panel")).toBeNull();
    expect(
      container?.querySelector('button[aria-label="Show voice bar"]')?.textContent
    ).toContain("Voice");
  });
});
