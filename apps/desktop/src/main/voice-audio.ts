import type { RealtimeAudioChunk } from "@shared";

const WAV_HEADER_BYTES = 44;
const PCM16_BYTES_PER_SAMPLE = 2;
const RIFF_CHUNK_ID = "RIFF";
const WAVE_FORMAT = "WAVE";
const FMT_CHUNK_ID = "fmt ";
const DATA_CHUNK_ID = "data";
const OPENAI_REALTIME_SAMPLE_RATE = 24_000;
const OPENAI_REALTIME_CHANNELS = 1;

const readAscii = (view: DataView, offset: number, length: number) => {
  let value = "";

  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index));
  }

  return value;
};

const decodeBase64 = (value: string) => Uint8Array.from(Buffer.from(value, "base64"));

const encodeBase64 = (value: Uint8Array) => Buffer.from(value).toString("base64");

const decodePcm16 = (chunk: RealtimeAudioChunk) => {
  const pcmBytes = decodeBase64(chunk.data);
  const pcm = new Int16Array(
    pcmBytes.buffer,
    pcmBytes.byteOffset,
    Math.floor(pcmBytes.byteLength / PCM16_BYTES_PER_SAMPLE)
  );
  const availableSamplesPerChannel = Math.floor(pcm.length / chunk.numChannels);
  const requestedSamplesPerChannel =
    chunk.samplesPerChannel ?? availableSamplesPerChannel;
  const samplesPerChannel = Math.max(
    0,
    Math.min(requestedSamplesPerChannel, availableSamplesPerChannel)
  );

  return {
    pcm,
    sampleRate: chunk.sampleRate,
    numChannels: chunk.numChannels,
    samplesPerChannel
  };
};

const encodePcm16 = (samples: Float32Array) => {
  const pcm = new Int16Array(samples.length);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    pcm[index] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }

  return new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
};

const downmixToMono = ({
  pcm,
  numChannels,
  samplesPerChannel
}: ReturnType<typeof decodePcm16>) => {
  if (numChannels === 1) {
    const mono = new Float32Array(samplesPerChannel);

    for (let index = 0; index < samplesPerChannel; index += 1) {
      mono[index] = (pcm[index] ?? 0) / 0x8000;
    }

    return mono;
  }

  const mono = new Float32Array(samplesPerChannel);

  for (let sampleIndex = 0; sampleIndex < samplesPerChannel; sampleIndex += 1) {
    let sum = 0;

    for (let channelIndex = 0; channelIndex < numChannels; channelIndex += 1) {
      const interleavedIndex = sampleIndex * numChannels + channelIndex;
      sum += (pcm[interleavedIndex] ?? 0) / 0x8000;
    }

    mono[sampleIndex] = sum / numChannels;
  }

  return mono;
};

const resampleMonoPcm = (
  samples: Float32Array,
  fromSampleRate: number,
  toSampleRate: number
) => {
  if (fromSampleRate === toSampleRate) {
    return samples;
  }

  const durationSeconds = samples.length / fromSampleRate;
  const targetLength = Math.max(1, Math.round(durationSeconds * toSampleRate));
  const resampled = new Float32Array(targetLength);
  const positionScale = fromSampleRate / toSampleRate;

  for (let targetIndex = 0; targetIndex < targetLength; targetIndex += 1) {
    const sourcePosition = targetIndex * positionScale;
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(leftIndex + 1, samples.length - 1);
    const mix = sourcePosition - leftIndex;
    const left = samples[leftIndex] ?? 0;
    const right = samples[rightIndex] ?? left;
    resampled[targetIndex] = left + (right - left) * mix;
  }

  return resampled;
};

export const createWavFileFromAudioChunks = (chunks: RealtimeAudioChunk[]) => {
  if (chunks.length === 0) {
    throw new Error("No audio chunks available for transcription.");
  }

  const [firstChunk] = chunks;

  if (!firstChunk) {
    throw new Error("Missing audio chunk.");
  }

  const sampleRate = firstChunk.sampleRate;
  const numChannels = firstChunk.numChannels;
  const pcmParts = chunks.map((chunk) => {
    if (chunk.sampleRate !== sampleRate || chunk.numChannels !== numChannels) {
      throw new Error("Voice audio format changed mid-session.");
    }

    return decodeBase64(chunk.data);
  });
  const pcmByteLength = pcmParts.reduce((sum, part) => sum + part.byteLength, 0);
  const wav = new Uint8Array(WAV_HEADER_BYTES + pcmByteLength);
  const view = new DataView(wav.buffer);

  wav.set(Buffer.from(RIFF_CHUNK_ID), 0);
  view.setUint32(4, 36 + pcmByteLength, true);
  wav.set(Buffer.from(WAVE_FORMAT), 8);
  wav.set(Buffer.from(FMT_CHUNK_ID), 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * PCM16_BYTES_PER_SAMPLE, true);
  view.setUint16(32, numChannels * PCM16_BYTES_PER_SAMPLE, true);
  view.setUint16(34, 16, true);
  wav.set(Buffer.from(DATA_CHUNK_ID), 36);
  view.setUint32(40, pcmByteLength, true);

  let offset = WAV_HEADER_BYTES;

  for (const part of pcmParts) {
    wav.set(part, offset);
    offset += part.byteLength;
  }

  return wav;
};

export const createRealtimeChunkFromWav = (wavBuffer: Uint8Array): RealtimeAudioChunk => {
  if (wavBuffer.byteLength < WAV_HEADER_BYTES) {
    throw new Error("TTS audio was shorter than a WAV header.");
  }

  const view = new DataView(
    wavBuffer.buffer,
    wavBuffer.byteOffset,
    wavBuffer.byteLength
  );

  if (readAscii(view, 0, 4) !== RIFF_CHUNK_ID || readAscii(view, 8, 4) !== WAVE_FORMAT) {
    throw new Error("TTS audio was not a WAV file.");
  }

  let offset = 12;
  let sampleRate = 24_000;
  let numChannels = 1;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataByteLength = -1;

  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    if (chunkId === FMT_CHUNK_ID && chunkSize >= 16) {
      sampleRate = view.getUint32(chunkDataOffset + 4, true);
      numChannels = view.getUint16(chunkDataOffset + 2, true);
      bitsPerSample = view.getUint16(chunkDataOffset + 14, true);
    }

    if (chunkId === DATA_CHUNK_ID) {
      dataOffset = chunkDataOffset;
      dataByteLength = chunkSize;
      break;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0 || dataByteLength <= 0) {
    throw new Error("TTS WAV file did not contain PCM data.");
  }

  if (bitsPerSample !== 16) {
    throw new Error(`Unsupported TTS sample format: ${bitsPerSample}-bit PCM.`);
  }

  const pcm = wavBuffer.subarray(dataOffset, dataOffset + dataByteLength);

  return {
    data: encodeBase64(pcm),
    sampleRate,
    numChannels,
    samplesPerChannel: pcm.byteLength / (numChannels * PCM16_BYTES_PER_SAMPLE)
  };
};

export const normalizeRealtimeInputChunk = (
  chunk: RealtimeAudioChunk
): RealtimeAudioChunk => {
  const decoded = decodePcm16(chunk);
  const mono = downmixToMono(decoded);
  const resampled = resampleMonoPcm(mono, decoded.sampleRate, OPENAI_REALTIME_SAMPLE_RATE);
  const normalizedPcm = encodePcm16(resampled);

  return {
    data: encodeBase64(normalizedPcm),
    sampleRate: OPENAI_REALTIME_SAMPLE_RATE,
    numChannels: OPENAI_REALTIME_CHANNELS,
    samplesPerChannel: resampled.length
  };
};
