import type { SessionState, VoiceState } from "@shared";

interface VoiceBarProps {
  sessionState: SessionState | null;
  state: VoiceState;
}

const helperCopy = (sessionState: SessionState | null) => {
  if (!sessionState) {
    return "Loading Codex session...";
  }

  if (sessionState.status === "connected" && sessionState.features.realtimeConversation) {
    return "Codex realtime available. Voice transport lands next.";
  }

  if (sessionState.status === "connected") {
    return "Codex connected. Waiting on realtime support.";
  }

  if (sessionState.status === "connecting") {
    return "Connecting app-server...";
  }

  return sessionState.error ?? "Codex session failed.";
};

export function VoiceBar({ sessionState, state }: VoiceBarProps) {
  return (
    <footer className="voice-bar stagger-4">
      <div className="voice-cluster">
        <button type="button" className="voice-button primary" disabled>
          Mic
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
        <small>{helperCopy(sessionState)}</small>
      </div>

      <div className="voice-actions">
        <button type="button" className="voice-button ghost" disabled>
          Devices
        </button>
        <button type="button" className="voice-button danger" disabled>
          Stop
        </button>
      </div>
    </footer>
  );
}
