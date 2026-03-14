import { describe, expect, it } from "vitest";
import type { RealtimeAudioChunk } from "@shared";
import {
  createRealtimeChunkFromWav,
  createWavFileFromAudioChunks,
  normalizeRealtimeInputChunk
} from "./voice-audio";

describe("voice-audio", () => {
  it("round-trips pcm chunks through wav encoding", () => {
    const chunk: RealtimeAudioChunk = {
      data: Buffer.from(new Uint8Array([0, 0, 255, 127, 0, 128, 1, 0])).toString("base64"),
      sampleRate: 24_000,
      numChannels: 1,
      samplesPerChannel: 4
    };

    const decoded = createRealtimeChunkFromWav(createWavFileFromAudioChunks([chunk]));

    expect(decoded).toEqual(chunk);
  });

  it("normalizes stereo realtime input to 24k mono pcm", () => {
    const stereoChunk: RealtimeAudioChunk = {
      data: Buffer.from(new Int16Array([1000, -1000, 2000, -2000]).buffer).toString("base64"),
      sampleRate: 48_000,
      numChannels: 2,
      samplesPerChannel: 2
    };

    const normalized = normalizeRealtimeInputChunk(stereoChunk);
    const pcmByteLength = Buffer.from(normalized.data, "base64").byteLength;

    expect(normalized.sampleRate).toBe(24_000);
    expect(normalized.numChannels).toBe(1);
    expect(normalized.samplesPerChannel).toBeGreaterThan(0);
    expect(pcmByteLength / 2).toBe(normalized.samplesPerChannel);
  });
});
