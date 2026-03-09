import { app } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { VoicePreferences } from "@shared";

const DEFAULT_PREFERENCES: VoicePreferences = {
  selectedInputDeviceId: "",
  selectedOutputDeviceId: "",
  deviceHintDismissed: false,
  deviceSetupComplete: false
};

class VoicePreferencesService {
  private get statePath() {
    return join(app.getPath("userData"), "voice-preferences.json");
  }

  getPreferences(): VoicePreferences {
    try {
      const raw = readFileSync(this.statePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<VoicePreferences>;

      return {
        ...DEFAULT_PREFERENCES,
        ...parsed
      };
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  }

  updatePreferences(nextPreferences: Partial<VoicePreferences>): VoicePreferences {
    const nextState = {
      ...this.getPreferences(),
      ...nextPreferences
    };

    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(this.statePath, JSON.stringify(nextState, null, 2), "utf8");

    return nextState;
  }
}

export const voicePreferencesService = new VoicePreferencesService();
