import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("AppSettingsService", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("caches persisted settings after the first disk read", async () => {
    const readFileSync = vi.fn(() =>
      JSON.stringify({ reduceMotion: true, autoNameNewThreads: true })
    );
    const writeFileSync = vi.fn();
    const mkdirSync = vi.fn();
    const getPath = vi.fn(() => "/tmp/codex");
    const getLoginItemSettings = vi.fn(() => ({ openAtLogin: false }));
    const setLoginItemSettings = vi.fn();

    vi.doMock("node:fs", () => ({
      mkdirSync,
      readFileSync,
      writeFileSync
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath,
        getLoginItemSettings,
        setLoginItemSettings
      },
      Notification: {
        isSupported: () => true
      }
    }));

    const { AppSettingsService } = await import("./app-settings-service");
    const service = new AppSettingsService();

    expect(service.getSettingsState().settings.reduceMotion).toBe(true);
    expect(service.getSettingsState().settings.autoNameNewThreads).toBe(true);
    expect(service.getSettingsState().settings.reduceMotion).toBe(true);
    expect(readFileSync).toHaveBeenCalledTimes(1);
  });

  it("reuses the cached state after updates", async () => {
    const readFileSync = vi.fn(() => JSON.stringify({ autoStartVoice: false }));
    const writeFileSync = vi.fn();
    const mkdirSync = vi.fn();
    const getPath = vi.fn(() => "/tmp/codex");
    const getLoginItemSettings = vi.fn(() => ({ openAtLogin: false }));
    const setLoginItemSettings = vi.fn();

    vi.doMock("node:fs", () => ({
      mkdirSync,
      readFileSync,
      writeFileSync
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath,
        getLoginItemSettings,
        setLoginItemSettings
      },
      Notification: {
        isSupported: () => true
      }
    }));

    const { AppSettingsService } = await import("./app-settings-service");
    const service = new AppSettingsService();

    service.getSettingsState();
    const nextState = service.updateSettings({
      autoNameNewThreads: true,
      autoStartVoice: true,
      launchAtLogin: true
    });

    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true
    });
    expect(nextState.settings.autoStartVoice).toBe(true);
    expect(nextState.settings.autoNameNewThreads).toBe(true);
    expect(service.getSettings().autoStartVoice).toBe(true);
    expect(readFileSync).toHaveBeenCalledTimes(1);
    expect(writeFileSync).toHaveBeenCalledWith(
      "/tmp/codex/app-settings.json",
      expect.stringContaining('"autoNameNewThreads": true'),
      "utf8"
    );
    expect(writeFileSync).toHaveBeenCalledWith(
      "/tmp/codex/app-settings.json",
      expect.stringContaining('"autoStartVoice": true'),
      "utf8"
    );
  });

  it("ignores invalid persisted fields and keeps defaults", async () => {
    const readFileSync = vi.fn(() =>
      JSON.stringify({
        reduceMotion: "true",
        density: "ultra-compact",
        notifyOnErrors: false,
        __proto__: {
          polluted: true
        }
      })
    );
    const writeFileSync = vi.fn();
    const mkdirSync = vi.fn();
    const getPath = vi.fn(() => "/tmp/codex");
    const getLoginItemSettings = vi.fn(() => ({ openAtLogin: false }));
    const setLoginItemSettings = vi.fn();

    vi.doMock("node:fs", () => ({
      mkdirSync,
      readFileSync,
      writeFileSync
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath,
        getLoginItemSettings,
        setLoginItemSettings
      },
      Notification: {
        isSupported: () => true
      }
    }));

    const { AppSettingsService } = await import("./app-settings-service");
    const service = new AppSettingsService();
    const state = service.getSettingsState().settings;

    expect(state.reduceMotion).toBe(false);
    expect(state.density).toBe("comfortable");
    expect(state.notifyOnErrors).toBe(false);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
