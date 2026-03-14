import { app } from "electron";
import { join } from "node:path";
import type { VoicePreferences } from "@shared";
import { readPersistedStateFile, writePersistedStateFile } from "./persisted-state";

const DEFAULT_PREFERENCES: VoicePreferences = {
  mode: "transcription",
  speakAgentActivity: true,
  speakToolCalls: true,
  speakPlanUpdates: true,
  selectedInputDeviceId: "",
  selectedOutputDeviceId: "",
  deviceHintDismissed: false,
  deviceSetupComplete: false
};

const clonePreferences = (preferences: VoicePreferences): VoicePreferences => ({
  ...preferences
});

const VOICE_PREFERENCES_VALIDATORS = {
  mode: (value: unknown): value is VoicePreferences["mode"] =>
    value === "transcription" || value === "realtime",
  speakAgentActivity: (value: unknown): value is boolean => typeof value === "boolean",
  speakToolCalls: (value: unknown): value is boolean => typeof value === "boolean",
  speakPlanUpdates: (value: unknown): value is boolean => typeof value === "boolean",
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
    return readPersistedStateFile(this.statePath, DEFAULT_PREFERENCES, VOICE_PREFERENCES_VALIDATORS);
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
    writePersistedStateFile(this.statePath, nextState);

    return clonePreferences(nextState);
  }

  resetPreferences(): VoicePreferences {
    this.cachedPreferences = clonePreferences(DEFAULT_PREFERENCES);
    writePersistedStateFile(this.statePath, DEFAULT_PREFERENCES);
    return clonePreferences(DEFAULT_PREFERENCES);
  }
}

export const voicePreferencesService = new VoicePreferencesService();
