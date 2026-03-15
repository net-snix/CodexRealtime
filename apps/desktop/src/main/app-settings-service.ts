import { app } from "electron";
import { join } from "node:path";
import type { AppSettings, AppSettingsState } from "@shared";
import { Notification } from "electron";
import { readPersistedStateFile, writePersistedStateFile } from "./persisted-state";

const DEFAULT_SETTINGS: AppSettings = {
  launchAtLogin: false,
  restoreLastWorkspace: true,
  reopenLastThread: true,
  autoNameNewThreads: false,
  autoStartVoice: false,
  showVoiceCaptions: true,
  windowScale: 100,
  density: "comfortable",
  theme: "system",
  reduceMotion: false,
  desktopNotifications: true,
  notifyOnApprovals: true,
  notifyOnTurnComplete: true,
  notifyOnErrors: true,
  developerMode: false
};

const cloneSettings = (settings: AppSettings): AppSettings => ({
  ...settings
});

const APP_SETTINGS_VALIDATORS = {
  launchAtLogin: (value: unknown): value is boolean => typeof value === "boolean",
  restoreLastWorkspace: (value: unknown): value is boolean => typeof value === "boolean",
  reopenLastThread: (value: unknown): value is boolean => typeof value === "boolean",
  autoNameNewThreads: (value: unknown): value is boolean => typeof value === "boolean",
  autoStartVoice: (value: unknown): value is boolean => typeof value === "boolean",
  showVoiceCaptions: (value: unknown): value is boolean => typeof value === "boolean",
  windowScale: (value: unknown): value is AppSettings["windowScale"] =>
    value === 25 || value === 50 || value === 100 || value === 150 || value === 200,
  density: (value: unknown): value is AppSettings["density"] => value === "comfortable" || value === "compact",
  theme: (value: unknown): value is AppSettings["theme"] =>
    value === "system" || value === "light" || value === "dark",
  reduceMotion: (value: unknown): value is boolean => typeof value === "boolean",
  desktopNotifications: (value: unknown): value is boolean => typeof value === "boolean",
  notifyOnApprovals: (value: unknown): value is boolean => typeof value === "boolean",
  notifyOnTurnComplete: (value: unknown): value is boolean => typeof value === "boolean",
  notifyOnErrors: (value: unknown): value is boolean => typeof value === "boolean",
  developerMode: (value: unknown): value is boolean => typeof value === "boolean"
} as const;

export class AppSettingsService {
  private cachedSettings: AppSettings | null = null;

  private get statePath() {
    return join(app.getPath("userData"), "app-settings.json");
  }

  private loadPersisted(): AppSettings {
    return readPersistedStateFile(this.statePath, DEFAULT_SETTINGS, APP_SETTINGS_VALIDATORS);
  }

  private readPersisted(): AppSettings {
    if (!this.cachedSettings) {
      this.cachedSettings = this.loadPersisted();
    }

    return this.cachedSettings;
  }

  private writePersisted(settings: AppSettings) {
    this.cachedSettings = cloneSettings(settings);
    writePersistedStateFile(this.statePath, settings);
  }

  getSettingsState(): AppSettingsState {
    const persisted = this.readPersisted();
    const loginItemSettings = app.getLoginItemSettings();

    return {
      settings: {
        ...persisted,
        launchAtLogin: Boolean(loginItemSettings.openAtLogin)
      },
      userDataPath: app.getPath("userData"),
      loginItemSupported: process.platform === "darwin",
      notificationsSupported: Notification.isSupported()
    };
  }

  getSettings(): AppSettings {
    return {
      ...this.readPersisted(),
      launchAtLogin: Boolean(app.getLoginItemSettings().openAtLogin)
    };
  }

  updateSettings(patch: Partial<AppSettings>): AppSettingsState {
    const current = this.readPersisted();
    const nextSettings: AppSettings = {
      ...current,
      ...patch
    };

    if (typeof patch.launchAtLogin === "boolean") {
      app.setLoginItemSettings({
        openAtLogin: patch.launchAtLogin
      });
      nextSettings.launchAtLogin = patch.launchAtLogin;
    }

    this.writePersisted(nextSettings);
    return this.getSettingsState();
  }
}

export const appSettingsService = new AppSettingsService();
