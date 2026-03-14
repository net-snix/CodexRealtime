import type { RealtimeAudioChunk } from "@shared";
import { voiceApiKeyService } from "./voice-api-key-service";
import { createRealtimeChunkFromWav } from "./voice-audio";

const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
const TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
const TTS_MODEL = "gpt-4o-mini-tts";
const TTS_VOICE = "alloy";

const parseApiError = async (response: Response) => {
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
    // Fall back below when the error payload is not JSON.
  }

  return response.statusText || `HTTP ${response.status}`;
};

const buildHeaders = (apiKey: string, extraHeaders: Record<string, string> = {}) => ({
  Authorization: `Bearer ${apiKey}`,
  ...extraHeaders
});

const requireApiKey = () => {
  const apiKey = voiceApiKeyService.getApiKey();

  if (!apiKey) {
    throw new Error("Add an OpenAI API key in Settings > Voice.");
  }

  return apiKey;
};

export class OpenAiVoiceClient {
  async transcribeWavAudio(wavAudio: Uint8Array) {
    const apiKey = requireApiKey();
    const form = new FormData();

    form.append("file", new Blob([wavAudio], { type: "audio/wav" }), "voice.wav");
    form.append("model", TRANSCRIPTION_MODEL);
    form.append("response_format", "json");

    const response = await fetch(`${OPENAI_API_BASE_URL}/audio/transcriptions`, {
      method: "POST",
      headers: buildHeaders(apiKey),
      body: form
    });

    if (!response.ok) {
      throw new Error(`Transcription failed: ${await parseApiError(response)}`);
    }

    const payload = (await response.json()) as {
      text?: string;
    };
    const transcript = payload.text?.trim() ?? "";

    if (!transcript) {
      throw new Error("Transcription returned no text.");
    }

    return transcript;
  }

  async synthesizeSpeech(input: string): Promise<RealtimeAudioChunk> {
    const apiKey = requireApiKey();
    const response = await fetch(`${OPENAI_API_BASE_URL}/audio/speech`, {
      method: "POST",
      headers: buildHeaders(apiKey, {
        "Content-Type": "application/json"
      }),
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: TTS_VOICE,
        input,
        format: "wav"
      })
    });

    if (!response.ok) {
      throw new Error(`Speech synthesis failed: ${await parseApiError(response)}`);
    }

    return createRealtimeChunkFromWav(new Uint8Array(await response.arrayBuffer()));
  }
}

export const openAiVoiceClient = new OpenAiVoiceClient();
