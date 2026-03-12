import { app } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { VoicePreferences } from "@shared";
import { readPersistedState } from "./persisted-state";

const DEFAULT_PREFERENCES: VoicePreferences = {
  selectedInputDeviceId: "",
  selectedOutputDeviceId: "",
  deviceHintDismissed: false,
  deviceSetupComplete: false
};

const clonePreferences = (preferences: VoicePreferences): VoicePreferences => ({
  ...preferences
});

const VOICE_PREFERENCES_VALIDATORS = {
  selectedInputDeviceId: (value: unknown): value is string => typeof value === "string",
  selectedOutputDeviceId: (value: unknown): value is string => typeof value === "string",
  deviceHintDismissed: (value: unknown): value is boolean => typeof value === "boolean",
  deviceSetupComplete: (value: unknown): value is boolean => typeof value === "boolean"
} as const;

export class VoicePreferencesService {
  private cachedPreferences: VoicePreferences | null = null;

  private get statePath() {
    return join(app.getPath("userData"), "voice-preferences.json");
  }

  private loadPreferences(): VoicePreferences {
    try {
      const raw = readFileSync(this.statePath, "utf8");
      return readPersistedState(raw, DEFAULT_PREFERENCES, VOICE_PREFERENCES_VALIDATORS);
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  }

  getPreferences(): VoicePreferences {
    if (!this.cachedPreferences) {
      this.cachedPreferences = this.loadPreferences();
    }

    return clonePreferences(this.cachedPreferences);
  }

  updatePreferences(nextPreferences: Partial<VoicePreferences>): VoicePreferences {
    const nextState = {
      ...this.getPreferences(),
      ...nextPreferences
    };

    this.cachedPreferences = clonePreferences(nextState);
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(this.statePath, JSON.stringify(nextState, null, 2), "utf8");

    return clonePreferences(nextState);
  }

  resetPreferences(): VoicePreferences {
    this.cachedPreferences = clonePreferences(DEFAULT_PREFERENCES);
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(this.statePath, JSON.stringify(DEFAULT_PREFERENCES, null, 2), "utf8");
    return clonePreferences(DEFAULT_PREFERENCES);
  }
}

export const voicePreferencesService = new VoicePreferencesService();
