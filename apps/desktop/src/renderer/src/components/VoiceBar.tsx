import type {
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
  liveTranscript: RealtimeTranscriptEntry[];
  onToggle: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
}

const helperCopy = (sessionState: SessionState | null, realtimeState: RealtimeState) => {
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
  liveTranscript,
  onToggle,
  onStop
  }: VoiceBarProps) {
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
          disabled={disabled}
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
        <strong>{state}</strong>
        <small>{helperCopy(sessionState, realtimeState)}</small>
        {latestTranscript ? (
          <p className="voice-caption">
            <span>{transcriptLabel}</span>
            {latestTranscript.text}
          </p>
        ) : null}
      </div>

      <div className="voice-actions">
        <button type="button" className="voice-button ghost" disabled>
          Devices
        </button>
        <button
          type="button"
          className="voice-button danger"
          disabled={!isActive}
          onClick={() => void onStop()}
        >
          Stop
        </button>
      </div>
    </footer>
  );
}
