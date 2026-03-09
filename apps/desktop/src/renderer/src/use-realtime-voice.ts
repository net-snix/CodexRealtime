import { useEffect, useRef, useState } from "react";
import type {
  RealtimeAudioChunk,
  RealtimeState,
  RealtimeTranscriptEntry,
  VoiceState
} from "@shared";

const initialRealtimeState: RealtimeState = {
  status: "idle",
  threadId: null,
  sessionId: null,
  error: null
};

const TRANSCRIPT_LIMIT = 6;

type ParsedRealtimeTranscriptEntry = RealtimeTranscriptEntry & {
  shouldDispatchPrompt: boolean;
};
const normalizePromptKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

const normalizeText = (value: unknown): string[] => {
  if (typeof value === "string") {
    const text = value.trim();
    return text ? [text] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeText(entry));
  }

  if (!isRecord(value)) {
    return [];
  }

  return [
    ...normalizeText(value.text),
    ...normalizeText(value.transcript),
    ...normalizeText(value.delta),
    ...normalizeText(value.summary),
    ...normalizeText(value.content)
  ];
};

const joinText = (...values: unknown[]) =>
  values
    .flatMap((value) => normalizeText(value))
    .filter((text, index, all) => all.indexOf(text) === index)
    .join("\n")
    .trim();

const parseRealtimeItem = (
  item: unknown,
  fallbackIndex: number
): ParsedRealtimeTranscriptEntry | null => {
  if (!isRecord(item)) {
    return null;
  }

  const type = typeof item.type === "string" ? item.type : "unknown";
  const id =
    typeof item.id === "string"
      ? item.id
      : typeof item.item_id === "string"
        ? item.item_id
        : typeof item.handoff_id === "string"
          ? item.handoff_id
          : `${type}-${fallbackIndex}`;
  const createdAt = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });

  if (type === "message") {
    const role = typeof item.role === "string" ? item.role : "system";
    const speaker: RealtimeTranscriptEntry["speaker"] =
      role === "assistant" ? "assistant" : role === "user" ? "user" : "system";
    const acceptedContentTypes =
      speaker === "assistant" ? ["output_text"] : speaker === "user" ? ["input_text"] : [];
    const text = acceptedContentTypes.length
      ? joinText(
          Array.isArray(item.content)
            ? item.content.filter(
                (entry) =>
                  isRecord(entry) &&
                  typeof entry.type === "string" &&
                  acceptedContentTypes.includes(entry.type)
              )
            : [],
          item.text,
          item.transcript
        )
      : joinText(item.text, item.transcript, item.content);

    return text
      ? {
          id,
          speaker,
          text,
          status: item.status === "in_progress" ? "partial" : "final",
          createdAt,
          shouldDispatchPrompt: speaker === "user"
        }
      : null;
  }

  if (type === "handoff_request") {
    const text = joinText(
      item.input_transcript,
      Array.isArray(item.messages)
        ? item.messages.map((message) => (isRecord(message) ? message.text : null))
        : []
    );

    return text
      ? {
          id,
          speaker: "user",
          text,
          status: "final",
          createdAt,
          shouldDispatchPrompt: true
        }
      : null;
  }

  return null;
};

const upsertTranscriptEntry = (
  entries: RealtimeTranscriptEntry[],
  nextEntry: RealtimeTranscriptEntry
) => {
  const existingIndex = entries.findIndex((entry) => entry.id === nextEntry.id);

  if (existingIndex >= 0) {
    const nextEntries = [...entries];
    nextEntries[existingIndex] = nextEntry;
    return nextEntries.slice(-TRANSCRIPT_LIMIT);
  }

  return [...entries, nextEntry].slice(-TRANSCRIPT_LIMIT);
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
  enabled,
  onVoicePrompt
}: {
  enabled: boolean;
  onVoicePrompt?: (prompt: string) => void | Promise<void>;
}) => {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [realtimeState, setRealtimeState] = useState<RealtimeState>(initialRealtimeState);
  const [isActive, setIsActive] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState<RealtimeTranscriptEntry[]>([]);
  const captureContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextPlaybackTimeRef = useRef(0);
  const dispatchedTranscriptIdsRef = useRef(new Set<string>());
  const lastDispatchedPromptRef = useRef("");
  const onVoicePromptRef = useRef(onVoicePrompt);

  useEffect(() => {
    onVoicePromptRef.current = onVoicePrompt;
  }, [onVoicePrompt]);

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
        setVoiceState("working");
        return;
      }

      if (event.type === "item") {
        let nextEntrySpeaker: RealtimeTranscriptEntry["speaker"] | null = null;
        let dispatchPrompt: string | null = null;

        setLiveTranscript((current) => {
          const nextEntry = parseRealtimeItem(event.item, current.length + 1);

          if (!nextEntry) {
            return current;
          }

          nextEntrySpeaker = nextEntry.speaker;
          if (
            nextEntry.shouldDispatchPrompt &&
            nextEntry.status === "final" &&
            !dispatchedTranscriptIdsRef.current.has(nextEntry.id) &&
            normalizePromptKey(nextEntry.text) !== lastDispatchedPromptRef.current
          ) {
            dispatchedTranscriptIdsRef.current.add(nextEntry.id);
            lastDispatchedPromptRef.current = normalizePromptKey(nextEntry.text);
            dispatchPrompt = nextEntry.text;
          }

          return upsertTranscriptEntry(current, nextEntry);
        });

        if (nextEntrySpeaker) {
          setVoiceState(nextEntrySpeaker === "assistant" ? "working" : "thinking");
        }

        if (dispatchPrompt) {
          void onVoicePromptRef.current?.(dispatchPrompt);
        }
        return;
      }

      if (event.type === "error") {
        setVoiceState("error");
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
    dispatchedTranscriptIdsRef.current.clear();
    lastDispatchedPromptRef.current = "";
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
    setLiveTranscript([]);
    dispatchedTranscriptIdsRef.current.clear();
    lastDispatchedPromptRef.current = "";
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
    liveTranscript,
    isActive,
    start,
    stop
  };
};
