import type { VoiceState } from "@shared";

interface VoiceBarProps {
  state: VoiceState;
}

export function VoiceBar({ state }: VoiceBarProps) {
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
        <small>Open mic later. Static shell now.</small>
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
