import { app } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppSettings, AppSettingsState } from "@shared";
import { Notification } from "electron";

const DEFAULT_SETTINGS: AppSettings = {
  launchAtLogin: false,
  restoreLastWorkspace: true,
  reopenLastThread: true,
  autoNameNewThreads: false,
  autoStartVoice: false,
  showVoiceCaptions: true,
  density: "comfortable",
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

export class AppSettingsService {
  private cachedSettings: AppSettings | null = null;

  private get statePath() {
    return join(app.getPath("userData"), "app-settings.json");
  }

  private loadPersisted(): AppSettings {
    try {
      const raw = readFileSync(this.statePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<AppSettings>;

      return {
        ...DEFAULT_SETTINGS,
        ...parsed
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private readPersisted(): AppSettings {
    if (!this.cachedSettings) {
      this.cachedSettings = this.loadPersisted();
    }

    return this.cachedSettings;
  }

  private writePersisted(settings: AppSettings) {
    this.cachedSettings = cloneSettings(settings);
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(this.statePath, JSON.stringify(settings, null, 2), "utf8");
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
