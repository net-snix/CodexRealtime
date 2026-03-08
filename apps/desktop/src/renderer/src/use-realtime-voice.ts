import { useEffect, useRef, useState } from "react";
import type { RealtimeAudioChunk, RealtimeState, VoiceState } from "@shared";

const initialRealtimeState: RealtimeState = {
  status: "idle",
  threadId: null,
  sessionId: null,
  error: null
};

const encodePcm16 = (samples: Float32Array) => {
  const pcm = new Int16Array(samples.length);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary);
};

const decodePcm16 = (chunk: RealtimeAudioChunk) => {
  const binary = atob(chunk.data);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const pcm = new Int16Array(bytes.buffer);
  const numChannels = Math.max(1, chunk.numChannels);
  const samplesPerChannel =
    chunk.samplesPerChannel ?? Math.floor(pcm.length / numChannels);
  const channels = Array.from({ length: numChannels }, () => new Float32Array(samplesPerChannel));

  for (let sampleIndex = 0; sampleIndex < samplesPerChannel; sampleIndex += 1) {
    for (let channelIndex = 0; channelIndex < numChannels; channelIndex += 1) {
      const interleavedIndex = sampleIndex * numChannels + channelIndex;
      channels[channelIndex][sampleIndex] = (pcm[interleavedIndex] ?? 0) / 0x7fff;
    }
  }

  return {
    channels,
    sampleRate: chunk.sampleRate
  };
};

const closeAudioContext = async (context: AudioContext | null) => {
  if (!context) {
    return;
  }

  if (context.state !== "closed") {
    await context.close();
  }
};

export const useRealtimeVoice = ({
  enabled
}: {
  enabled: boolean;
}) => {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [realtimeState, setRealtimeState] = useState<RealtimeState>(initialRealtimeState);
  const [isActive, setIsActive] = useState(false);
  const captureContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextPlaybackTimeRef = useRef(0);

  useEffect(() => {
    void window.appBridge.getRealtimeState().then(setRealtimeState);

    const unsubscribe = window.appBridge.subscribeRealtimeEvents((event) => {
      if (event.type === "state") {
        setRealtimeState(event.state);
        setVoiceState(
          event.state.status === "live"
            ? "listening"
            : event.state.status === "connecting"
              ? "thinking"
              : event.state.status === "error"
                ? "error"
                : "idle"
        );
        return;
      }

      if (event.type === "audio") {
        void scheduleAudioPlayback(event.audio);
      }
    });

    return () => {
      unsubscribe();
      void stop();
    };
  }, []);

  const scheduleAudioPlayback = async (chunk: RealtimeAudioChunk) => {
    const decoded = decodePcm16(chunk);
    const context =
      playbackContextRef.current ?? new AudioContext({ sampleRate: decoded.sampleRate });

    playbackContextRef.current = context;

    if (context.state === "suspended") {
      await context.resume();
    }

    const audioBuffer = context.createBuffer(
      decoded.channels.length,
      decoded.channels[0]?.length ?? 0,
      decoded.sampleRate
    );

    decoded.channels.forEach((channel, channelIndex) => {
      audioBuffer.copyToChannel(channel, channelIndex);
    });

    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);

    const startAt = Math.max(context.currentTime + 0.02, nextPlaybackTimeRef.current);
    source.start(startAt);
    nextPlaybackTimeRef.current = startAt + audioBuffer.duration;
  };

  const start = async () => {
    if (!enabled || isActive) {
      return;
    }

    setVoiceState("thinking");
    await window.appBridge.startRealtime();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      }
    });
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (event) => {
      const channel = event.inputBuffer.getChannelData(0);

      void window.appBridge.appendRealtimeAudio({
        data: encodePcm16(channel),
        sampleRate: context.sampleRate,
        numChannels: 1,
        samplesPerChannel: channel.length
      });
    };

    source.connect(processor);
    processor.connect(context.destination);

    streamRef.current = stream;
    captureContextRef.current = context;
    sourceRef.current = source;
    processorRef.current = processor;
    setIsActive(true);
  };

  const stop = async () => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current = null;

    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }

    streamRef.current = null;
    await closeAudioContext(captureContextRef.current);
    captureContextRef.current = null;
    nextPlaybackTimeRef.current = 0;
    setIsActive(false);
    setVoiceState("idle");

    try {
      await window.appBridge.stopRealtime();
    } catch {
      // Keep local teardown best-effort for prototype mode.
    }
  };

  return {
    voiceState,
    realtimeState,
    isActive,
    start,
    stop
  };
};
