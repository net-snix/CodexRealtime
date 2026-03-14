import { useEffect, useState } from "react";
import type {
  AudioDeviceOption,
  VoiceApiKeyState,
  VoiceMode,
  RealtimeState,
  RealtimeTranscriptEntry,
  SessionState,
  VoiceState
} from "@shared";

interface VoiceBarProps {
  isOpen: boolean;
  sessionState: SessionState | null;
  voiceMode: VoiceMode;
  voiceApiKeyState: VoiceApiKeyState;
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
  voiceMode: VoiceMode,
  voiceApiKeyState: VoiceApiKeyState,
  realtimeState: RealtimeState,
  isStopping: boolean
) => {
  if (isStopping) {
    return "Stopping voice and active work.";
  }

  if (realtimeState.error) {
    return realtimeState.error;
  }

  if (realtimeState.status === "live") {
    return voiceMode === "transcription" ? "Voice session ready." : "Voice connected.";
  }

  if (realtimeState.status === "connecting") {
    return voiceMode === "transcription"
      ? "Transcribing and handing off..."
      : "Connecting voice...";
  }

  if (!sessionState) {
    return "Loading session...";
  }

  if (!voiceApiKeyState.configured || voiceApiKeyState.status !== "valid") {
    return voiceMode === "transcription"
      ? "Transcription voice requires a valid OpenAI API key."
      : "Realtime voice requires a valid OpenAI API key.";
  }

  if (sessionState.status === "connected") {
    return "Voice agent ready.";
  }

  if (sessionState.status === "connecting") {
    return "Connecting...";
  }

  return sessionState.error ?? "Session failed.";
};

export function VoiceBar({
  isOpen,
  sessionState,
  voiceMode,
  voiceApiKeyState,
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

  useEffect(() => {
    if (!isOpen) {
      setIsDevicePickerOpen(false);
    }
  }, [isOpen]);

  return (
    <footer
      className={`voice-bar${isOpen ? "" : " voice-bar-collapsed"}`}
    >
      <div className="voice-bar-body">
        <div className="voice-cluster voice-bar-panel-section">
          <button
            type="button"
            className="voice-button primary"
            disabled={disabled || isStopping}
            onClick={() => void onToggle()}
          >
            {isActive ? "Mic on" : "Start mic"}
          </button>
          <div className="voice-meter" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>

        <div className="voice-status voice-bar-panel-section">
          <strong>{isStopping ? "stopping" : state}</strong>
          <small>{helperCopy(sessionState, voiceMode, voiceApiKeyState, realtimeState, isStopping)}</small>
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

        <div className="voice-actions voice-bar-panel-section">
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

      </div>

      {isOpen && isDevicePickerOpen ? (
        <div className="voice-device-panel">
          {shouldShowDeviceHint ? (
            <div className="voice-device-hint" role="note">
              <p>
                Start the mic once to unlock device names.
              </p>
              <p>
                {supportsOutputSelection
                  ? "Output changes apply right away."
                  : "Output stays on the system default."}
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
              ? "Output applies now. Input applies next mic start."
              : "Output uses the system default."}
          </p>
        </div>
      ) : null}
    </footer>
  );
}
