import { app, safeStorage } from "electron";
import { join } from "node:path";
import type { VoiceApiKeyState, VoiceApiKeyStatus } from "@shared";
import { readPersistedStateFile, writePersistedStateFile } from "./persisted-state";

type PersistedVoiceApiKeyState = {
  encryptedValue: string;
  status: VoiceApiKeyStatus;
  lastValidatedAt: string | null;
  error: string | null;
};

const DEFAULT_STATE: PersistedVoiceApiKeyState = {
  encryptedValue: "",
  status: "missing",
  lastValidatedAt: null,
  error: null
};

const VOICE_API_KEY_VALIDATORS = {
  encryptedValue: (value: unknown): value is string => typeof value === "string",
  status: (value: unknown): value is VoiceApiKeyStatus =>
    value === "missing" || value === "valid" || value === "invalid",
  lastValidatedAt: (value: unknown): value is string | null =>
    typeof value === "string" || value === null,
  error: (value: unknown): value is string | null =>
    typeof value === "string" || value === null
} as const;

const cloneState = (state: PersistedVoiceApiKeyState): PersistedVoiceApiKeyState => ({
  ...state
});

const toPublicState = (state: PersistedVoiceApiKeyState): VoiceApiKeyState => ({
  configured: Boolean(state.encryptedValue),
  status: state.status,
  lastValidatedAt: state.lastValidatedAt,
  error: state.error
});

const trimApiKey = (apiKey: string) => apiKey.trim();

const toApiErrorMessage = async (response: Response) => {
  try {
    const payload = (await response.json()) as {
      error?: {
        message?: string;
      };
    };

    if (payload.error?.message?.trim()) {
      return payload.error.message.trim();
    }
  } catch {
    // Fall back to status text below.
  }

  return response.statusText || `HTTP ${response.status}`;
};

export class VoiceApiKeyService {
  private cachedState: PersistedVoiceApiKeyState | null = null;

  private get statePath() {
    return join(app.getPath("userData"), "voice-api-key.json");
  }

  private loadPersisted(): PersistedVoiceApiKeyState {
    return readPersistedStateFile(this.statePath, DEFAULT_STATE, VOICE_API_KEY_VALIDATORS);
  }

  private readPersisted(): PersistedVoiceApiKeyState {
    if (!this.cachedState) {
      this.cachedState = this.loadPersisted();
    }

    return cloneState(this.cachedState);
  }

  private writePersisted(state: PersistedVoiceApiKeyState) {
    this.cachedState = cloneState(state);
    writePersistedStateFile(this.statePath, state);
  }

  private assertSecureStorageAvailable() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure storage is unavailable on this device.");
    }
  }

  private encryptApiKey(apiKey: string) {
    this.assertSecureStorageAvailable();
    return safeStorage.encryptString(apiKey).toString("base64");
  }

  private decryptApiKey(encryptedValue: string) {
    this.assertSecureStorageAvailable();
    return safeStorage.decryptString(Buffer.from(encryptedValue, "base64"));
  }

  private buildValidatedState(status: VoiceApiKeyStatus, error: string | null): PersistedVoiceApiKeyState {
    return {
      ...this.readPersisted(),
      status,
      lastValidatedAt: new Date().toISOString(),
      error
    };
  }

  private async validateApiKey(apiKey: string) {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    if (response.ok) {
      return { ok: true as const, error: null };
    }

    return {
      ok: false as const,
      error: await toApiErrorMessage(response)
    };
  }

  getState(): VoiceApiKeyState {
    return toPublicState(this.readPersisted());
  }

  getApiKey(): string | null {
    const state = this.readPersisted();

    if (!state.encryptedValue) {
      return null;
    }

    return this.decryptApiKey(state.encryptedValue);
  }

  async setApiKey(rawApiKey: string): Promise<VoiceApiKeyState> {
    const apiKey = trimApiKey(rawApiKey);

    if (!apiKey) {
      const nextState: PersistedVoiceApiKeyState = {
        encryptedValue: "",
        status: "invalid",
        lastValidatedAt: new Date().toISOString(),
        error: "Enter an OpenAI API key."
      };
      this.writePersisted(nextState);
      return toPublicState(nextState);
    }

    this.assertSecureStorageAvailable();
    const validation = await this.validateApiKey(apiKey);

    if (!validation.ok) {
      const nextState: PersistedVoiceApiKeyState = {
        encryptedValue: "",
        status: "invalid",
        lastValidatedAt: new Date().toISOString(),
        error: validation.error
      };
      this.writePersisted(nextState);
      return toPublicState(nextState);
    }

    const nextState: PersistedVoiceApiKeyState = {
      encryptedValue: this.encryptApiKey(apiKey),
      status: "valid",
      lastValidatedAt: new Date().toISOString(),
      error: null
    };
    this.writePersisted(nextState);
    return toPublicState(nextState);
  }

  clearApiKey(): VoiceApiKeyState {
    const nextState = cloneState(DEFAULT_STATE);
    this.writePersisted(nextState);
    return toPublicState(nextState);
  }

  async testApiKey(): Promise<VoiceApiKeyState> {
    const current = this.readPersisted();

    if (!current.encryptedValue) {
      const nextState: PersistedVoiceApiKeyState = {
        ...current,
        status: "missing",
        lastValidatedAt: null,
        error: "Add an OpenAI API key first."
      };
      this.writePersisted(nextState);
      return toPublicState(nextState);
    }

    const validation = await this.validateApiKey(this.decryptApiKey(current.encryptedValue));
    const nextState = this.buildValidatedState(validation.ok ? "valid" : "invalid", validation.error);
    this.writePersisted(nextState);
    return toPublicState(nextState);
  }
}

export const voiceApiKeyService = new VoiceApiKeyService();
