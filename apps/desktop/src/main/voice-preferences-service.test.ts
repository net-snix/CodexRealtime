import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("VoicePreferencesService", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("caches preferences after the first load", async () => {
    const readFileSync = vi.fn(() => JSON.stringify({ selectedInputDeviceId: "mic-1" }));
    const statSync = vi.fn(() => ({ size: 64 }));
    const writeFileSync = vi.fn();
    const mkdirSync = vi.fn();
    const getPath = vi.fn(() => "/tmp/codex");

    vi.doMock("node:fs", () => ({
      mkdirSync,
      readFileSync,
      statSync,
      writeFileSync
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath
      }
    }));

    const { VoicePreferencesService } = await import("./voice-preferences-service");
    const service = new VoicePreferencesService();

    expect(service.getPreferences().selectedInputDeviceId).toBe("mic-1");
    expect(service.getPreferences().selectedInputDeviceId).toBe("mic-1");
    expect(readFileSync).toHaveBeenCalledTimes(1);
  });

  it("updates and resets the cached preferences without rereading disk", async () => {
    const readFileSync = vi.fn(() => JSON.stringify({ selectedOutputDeviceId: "speaker-1" }));
    const statSync = vi.fn(() => ({ size: 64 }));
    const writeFileSync = vi.fn();
    const mkdirSync = vi.fn();
    const getPath = vi.fn(() => "/tmp/codex");

    vi.doMock("node:fs", () => ({
      mkdirSync,
      readFileSync,
      statSync,
      writeFileSync
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath
      }
    }));

    const { VoicePreferencesService } = await import("./voice-preferences-service");
    const service = new VoicePreferencesService();

    service.getPreferences();
    const updated = service.updatePreferences({
      deviceSetupComplete: true
    });
    const reset = service.resetPreferences();

    expect(updated.deviceSetupComplete).toBe(true);
    expect(reset.deviceSetupComplete).toBe(false);
    expect(service.getPreferences().deviceSetupComplete).toBe(false);
    expect(readFileSync).toHaveBeenCalledTimes(1);
    expect(writeFileSync).toHaveBeenLastCalledWith(
      "/tmp/codex/voice-preferences.json",
      expect.stringContaining('"deviceSetupComplete": false'),
      "utf8"
    );
  });

  it("accepts only correctly typed persisted preference fields", async () => {
    const readFileSync = vi.fn(() =>
      JSON.stringify({
        selectedInputDeviceId: 42,
        selectedOutputDeviceId: "speaker-1",
        deviceHintDismissed: "yes",
        deviceSetupComplete: true
      })
    );
    const statSync = vi.fn(() => ({ size: 128 }));
    const writeFileSync = vi.fn();
    const mkdirSync = vi.fn();
    const getPath = vi.fn(() => "/tmp/codex");

    vi.doMock("node:fs", () => ({
      mkdirSync,
      readFileSync,
      statSync,
      writeFileSync
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath
      }
    }));

    const { VoicePreferencesService } = await import("./voice-preferences-service");
    const service = new VoicePreferencesService();
    const preferences = service.getPreferences();

    expect(preferences.selectedInputDeviceId).toBe("");
    expect(preferences.selectedOutputDeviceId).toBe("speaker-1");
    expect(preferences.deviceHintDismissed).toBe(false);
    expect(preferences.deviceSetupComplete).toBe(true);
  });
});
