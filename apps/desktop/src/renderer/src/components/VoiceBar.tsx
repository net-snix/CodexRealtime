import { useState } from "react";
import type {
  AudioDeviceOption,
  RealtimeState,
  RealtimeTranscriptEntry,
  SessionState,
  VoiceState
} from "@shared";

interface VoiceBarProps {
  sessionState: SessionState | null;
  state: VoiceState;
  realtimeState: RealtimeState;
  disabled: boolean;
  isActive: boolean;
  isStopping: boolean;
  feedback: {
    tone: "neutral" | "success" | "error";
    text: string;
  } | null;
  canStop: boolean;
  liveTranscript: RealtimeTranscriptEntry[];
  inputDevices: AudioDeviceOption[];
  outputDevices: AudioDeviceOption[];
  selectedInputDeviceId: string;
  selectedOutputDeviceId: string;
  supportsOutputSelection: boolean;
  shouldShowDeviceHint: boolean;
  onDismissDeviceHint: () => void;
  onInputDeviceChange: (deviceId: string) => void;
  onOutputDeviceChange: (deviceId: string) => void;
  onToggle: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
}

const helperCopy = (
  sessionState: SessionState | null,
  realtimeState: RealtimeState,
  isStopping: boolean
) => {
  if (isStopping) {
    return "Stopping mic and interrupting active work...";
  }

  if (realtimeState.error) {
    return realtimeState.error;
  }

  if (realtimeState.status === "live") {
    return "Realtime thread connected. Transcript rolls in live.";
  }

  if (realtimeState.status === "connecting") {
    return "Opening realtime voice transport...";
  }

  if (!sessionState) {
    return "Loading Codex session...";
  }

  if (sessionState.status === "connected" && sessionState.features.realtimeConversation) {
    return "Codex realtime ready when you open the mic.";
  }

  if (sessionState.status === "connected") {
    return "Codex connected. Waiting on realtime support.";
  }

  if (sessionState.status === "connecting") {
    return "Connecting app-server...";
  }

  return sessionState.error ?? "Codex session failed.";
};

export function VoiceBar({
  sessionState,
  state,
  realtimeState,
  disabled,
  isActive,
  isStopping,
  feedback,
  canStop,
  liveTranscript,
  inputDevices,
  outputDevices,
  selectedInputDeviceId,
  selectedOutputDeviceId,
  supportsOutputSelection,
  shouldShowDeviceHint,
  onDismissDeviceHint,
  onInputDeviceChange,
  onOutputDeviceChange,
  onToggle,
  onStop
  }: VoiceBarProps) {
  const [isDevicePickerOpen, setIsDevicePickerOpen] = useState(false);
  const latestTranscript = liveTranscript.at(-1) ?? null;
  const transcriptLabel =
    latestTranscript?.speaker === "user"
      ? "You"
      : latestTranscript?.speaker === "assistant"
        ? "Codex"
        : "Thread";

  return (
    <footer className="voice-bar stagger-4">
      <div className="voice-cluster">
        <button
          type="button"
          className="voice-button primary"
          disabled={disabled || isStopping}
          onClick={() => void onToggle()}
        >
          {isActive ? "Mic live" : "Start mic"}
        </button>
        <div className="voice-meter" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>

      <div className="voice-status">
        <span className="panel-eyebrow">State</span>
        <strong>{isStopping ? "stopping" : state}</strong>
        <small>{helperCopy(sessionState, realtimeState, isStopping)}</small>
        {feedback ? (
          <p className={`voice-feedback voice-feedback-${feedback.tone}`}>{feedback.text}</p>
        ) : null}
        {latestTranscript ? (
          <p className="voice-caption">
            <span>{transcriptLabel}</span>
            {latestTranscript.text}
          </p>
        ) : null}
      </div>

      <div className="voice-actions">
        <button
          type="button"
          className="voice-button ghost"
          onClick={() => setIsDevicePickerOpen((current) => !current)}
        >
          Devices
        </button>
        <button
          type="button"
          className="voice-button danger"
          disabled={!canStop || isStopping}
          onClick={() => void onStop()}
        >
          {isStopping ? "Stopping…" : "Stop"}
        </button>
      </div>

      {isDevicePickerOpen ? (
        <div className="voice-device-panel">
          {shouldShowDeviceHint ? (
            <div className="voice-device-hint" role="note">
              <p>
                Start the mic once to unlock full device names. Until then, this panel may show
                generic labels.
              </p>
              <p>
                {supportsOutputSelection
                  ? "Output changes apply right away after labels appear."
                  : "Output stays on the system default in this runtime."}
              </p>
              <button
                type="button"
                className="voice-device-hint-dismiss"
                onClick={onDismissDeviceHint}
              >
                Hide tip
              </button>
            </div>
          ) : null}

          <label className="voice-device-field">
            <span>Input</span>
            <select
              value={selectedInputDeviceId}
              onChange={(event) => onInputDeviceChange(event.target.value)}
            >
              {inputDevices.map((device) => (
                <option key={`input-${device.id || "default"}`} value={device.id}>
                  {device.label}
                </option>
              ))}
            </select>
          </label>

          <label className="voice-device-field">
            <span>Output</span>
            <select
              value={selectedOutputDeviceId}
              onChange={(event) => onOutputDeviceChange(event.target.value)}
              disabled={!supportsOutputSelection}
            >
              {outputDevices.map((device) => (
                <option key={`output-${device.id || "default"}`} value={device.id}>
                  {device.label}
                </option>
              ))}
            </select>
          </label>

          <p className="voice-device-note">
            {supportsOutputSelection
              ? "Output changes apply right away. Input changes apply next mic start."
              : "Output routing uses the system default on this browser runtime."}
          </p>
        </div>
      ) : null}
    </footer>
  );
}
