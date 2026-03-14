import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("VoiceApiKeyService", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves a validated API key without exposing plaintext in state", async () => {
    const readFileSync = vi.fn(() => JSON.stringify({}));
    const statSync = vi.fn(() => ({ size: 64 }));
    const writeFileSync = vi.fn();
    const mkdirSync = vi.fn();
    const getPath = vi.fn(() => "/tmp/codex");
    const encryptString = vi.fn((value: string) => Buffer.from(`enc:${value}`));
    const decryptString = vi.fn((value: Buffer) => value.toString("utf8").replace(/^enc:/, ""));

    vi.doMock("node:fs", () => ({
      mkdirSync,
      readFileSync,
      statSync,
      writeFileSync
    }));
    vi.doMock("electron", () => ({
      app: {
        getPath
      },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString,
        decryptString
      }
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))
    );

    const { VoiceApiKeyService } = await import("./voice-api-key-service");
    const service = new VoiceApiKeyService();
    const state = await service.setApiKey("sk-test-123");

    expect(state.configured).toBe(true);
    expect(state.status).toBe("valid");
    expect(state.error).toBeNull();
    expect(encryptString).toHaveBeenCalledWith("sk-test-123");
    expect(service.getApiKey()).toBe("sk-test-123");
    expect(writeFileSync).toHaveBeenCalledWith(
      "/tmp/codex/voice-api-key.json",
      expect.not.stringContaining("sk-test-123"),
      "utf8"
    );
  });

  it("keeps invalid API keys out of secure storage", async () => {
    const readFileSync = vi.fn(() => JSON.stringify({}));
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
      },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: vi.fn((value: string) => Buffer.from(`enc:${value}`)),
        decryptString: vi.fn((value: Buffer) => value.toString("utf8").replace(/^enc:/, ""))
      }
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "Incorrect API key provided" } }), {
            status: 401,
            statusText: "Unauthorized"
          })
      )
    );

    const { VoiceApiKeyService } = await import("./voice-api-key-service");
    const service = new VoiceApiKeyService();
    const state = await service.setApiKey("sk-bad");

    expect(state.configured).toBe(false);
    expect(state.status).toBe("invalid");
    expect(state.error).toContain("Incorrect API key provided");
    expect(service.getApiKey()).toBeNull();
  });

  it("clears the stored key and resets state", async () => {
    const readFileSync = vi.fn(() =>
      JSON.stringify({
        encryptedValue: Buffer.from("enc:sk-saved").toString("base64"),
        status: "valid",
        lastValidatedAt: "2026-03-14T10:00:00.000Z",
        error: null
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
      },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: vi.fn((value: string) => Buffer.from(`enc:${value}`)),
        decryptString: vi.fn((value: Buffer) => value.toString("utf8").replace(/^enc:/, ""))
      }
    }));

    const { VoiceApiKeyService } = await import("./voice-api-key-service");
    const service = new VoiceApiKeyService();
    const state = service.clearApiKey();

    expect(state).toEqual({
      configured: false,
      status: "missing",
      lastValidatedAt: null,
      error: null
    });
    expect(writeFileSync).toHaveBeenLastCalledWith(
      "/tmp/codex/voice-api-key.json",
      expect.stringContaining('"status": "missing"'),
      "utf8"
    );
  });
});
