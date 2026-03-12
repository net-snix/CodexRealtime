import { useEffect, useEffectEvent, useRef, useState } from "react";
import type {
  AudioDeviceOption,
  NativeApi,
  RealtimeAudioChunk,
  RealtimeState,
  RealtimeTranscriptEntry,
  VoiceState
} from "@shared";
import { ensureNativeApi } from "./native-api";

const initialRealtimeState: RealtimeState = {
  status: "idle",
  threadId: null,
  sessionId: null,
  error: null
};

const TRANSCRIPT_LIMIT = 6;
const MAX_QUEUED_AUDIO_CHUNKS = 4;
const MAX_DISPATCHED_TRANSCRIPT_IDS = 128;
const PCM16_BASE64_CHUNK_SIZE = 0x8000;
const MIN_AUDIO_SAMPLE_RATE = 8_000;
const MAX_AUDIO_SAMPLE_RATE = 192_000;
const MAX_AUDIO_CHANNELS = 8;
const MAX_PCM16_BYTES_PER_CHUNK = 8 * 1024 * 1024;
const MAX_SAMPLES_PER_CHANNEL = 262_144;

type ParsedRealtimeTranscriptEntry = RealtimeTranscriptEntry & {
  shouldDispatchPrompt: boolean;
};
type PersistedVoicePreferences = Awaited<ReturnType<NativeApi["getVoicePreferences"]>>;
type AudioOutputElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
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

const joinText = (...values: unknown[]) => {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    for (const text of normalizeText(value)) {
      if (seen.has(text)) {
        continue;
      }

      seen.add(text);
      unique.push(text);
    }
  }

  return unique.join("\n").trim();
};

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

const rememberDispatchedTranscriptId = (ids: Set<string>, id: string) => {
  if (ids.has(id)) {
    return;
  }

  ids.add(id);

  if (ids.size <= MAX_DISPATCHED_TRANSCRIPT_IDS) {
    return;
  }

  const oldestId = ids.values().next().value;
  if (typeof oldestId === "string") {
    ids.delete(oldestId);
  }
};

const encodePcm16 = (samples: Float32Array) => {
  const bytes = new Uint8Array(samples.length * 2);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    const pcmValue = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    const byteOffset = index * 2;
    bytes[byteOffset] = pcmValue & 0xff;
    bytes[byteOffset + 1] = (pcmValue >> 8) & 0xff;
  }

  const binaryChunks: string[] = [];

  for (let index = 0; index < bytes.length; index += PCM16_BASE64_CHUNK_SIZE) {
    binaryChunks.push(
      String.fromCharCode(...bytes.subarray(index, index + PCM16_BASE64_CHUNK_SIZE))
    );
  }

  return btoa(binaryChunks.join(""));
};

const decodePcm16 = (chunk: RealtimeAudioChunk) => {
  if (
    !Number.isFinite(chunk.sampleRate) ||
    chunk.sampleRate < MIN_AUDIO_SAMPLE_RATE ||
    chunk.sampleRate > MAX_AUDIO_SAMPLE_RATE
  ) {
    throw new Error("Invalid realtime audio sample rate");
  }

  if (
    !Number.isInteger(chunk.numChannels) ||
    chunk.numChannels < 1 ||
    chunk.numChannels > MAX_AUDIO_CHANNELS
  ) {
    throw new Error("Invalid realtime audio channel count");
  }

  const binary = atob(chunk.data);
  if (
    binary.length === 0 ||
    binary.length % 2 !== 0 ||
    binary.length > MAX_PCM16_BYTES_PER_CHUNK
  ) {
    throw new Error("Invalid realtime audio payload");
  }

  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const pcm = new Int16Array(bytes.buffer);
  const numChannels = chunk.numChannels;
  const availableSamplesPerChannel = Math.floor(pcm.length / numChannels);
  const requestedSamplesPerChannel =
    chunk.samplesPerChannel ?? availableSamplesPerChannel;

  if (
    !Number.isInteger(requestedSamplesPerChannel) ||
    requestedSamplesPerChannel < 1 ||
    requestedSamplesPerChannel > MAX_SAMPLES_PER_CHANNEL
  ) {
    throw new Error("Invalid realtime samples-per-channel count");
  }

  const samplesPerChannel = Math.min(
    requestedSamplesPerChannel,
    availableSamplesPerChannel
  );
  const channels = Array.from(
    { length: numChannels },
    () => new Float32Array(samplesPerChannel)
  );

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

const toDeviceOptions = (
  devices: MediaDeviceInfo[],
  kind: MediaDeviceKind
): AudioDeviceOption[] => {
  const filtered = devices.filter((device) => device.kind === kind);

  return [
    {
      id: "",
      label: kind === "audioinput" ? "System default input" : "System default output"
    },
    ...filtered.map((device, index) => ({
      id: device.deviceId,
      label:
        device.label ||
        `${kind === "audioinput" ? "Input" : "Output"} ${index + 1}`
    }))
  ];
};

export const useRealtimeVoice = ({
  enabled,
  onVoicePrompt
}: {
  enabled: boolean;
  onVoicePrompt?: (prompt: string) => void | Promise<void>;
}) => {
  const nativeApiRef = useRef<NativeApi | null>(null);
  if (!nativeApiRef.current) {
    nativeApiRef.current = ensureNativeApi();
  }

  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [realtimeState, setRealtimeState] = useState<RealtimeState>(initialRealtimeState);
  const [isActive, setIsActive] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState<RealtimeTranscriptEntry[]>([]);
  const [inputDevices, setInputDevices] = useState<AudioDeviceOption[]>([
    { id: "", label: "System default input" }
  ]);
  const [outputDevices, setOutputDevices] = useState<AudioDeviceOption[]>([
    { id: "", label: "System default output" }
  ]);
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState("");
  const [selectedOutputDeviceId, setSelectedOutputDeviceId] = useState("");
  const [supportsOutputSelection, setSupportsOutputSelection] = useState(false);
  const [isDeviceHintDismissed, setIsDeviceHintDismissed] = useState(false);
  const [hasCompletedDeviceSetup, setHasCompletedDeviceSetup] = useState(false);
  const [hasLoadedPreferences, setHasLoadedPreferences] = useState(false);
  const captureContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const playbackElementRef = useRef<AudioOutputElement | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextPlaybackTimeRef = useRef(0);
  const queuedAudioChunksRef = useRef<RealtimeAudioChunk[]>([]);
  const isSendingAudioRef = useRef(false);
  const audioSendGenerationRef = useRef(0);
  const dispatchedTranscriptIdsRef = useRef(new Set<string>());
  const lastDispatchedPromptRef = useRef("");
  const onVoicePromptRef = useRef(onVoicePrompt);

  const flushQueuedAudio = async () => {
    if (isSendingAudioRef.current) {
      return;
    }

    const generation = audioSendGenerationRef.current;
    isSendingAudioRef.current = true;

    try {
      while (
        audioSendGenerationRef.current === generation &&
        queuedAudioChunksRef.current.length > 0
      ) {
        const nextChunk = queuedAudioChunksRef.current.shift();

        if (!nextChunk) {
          continue;
        }

        try {
          await nativeApiRef.current!.appendRealtimeAudio(nextChunk);
        } catch {
          // Keep capture responsive if a single realtime chunk fails to send.
        }
      }
    } finally {
      if (audioSendGenerationRef.current !== generation) {
        return;
      }

      isSendingAudioRef.current = false;

      if (queuedAudioChunksRef.current.length > 0) {
        void flushQueuedAudio();
      }
    }
  };

  const queueAudioChunk = (chunk: RealtimeAudioChunk) => {
    const queuedChunks = queuedAudioChunksRef.current;

    if (queuedChunks.length >= MAX_QUEUED_AUDIO_CHUNKS) {
      queuedChunks.shift();
    }

    queuedChunks.push(chunk);
    void flushQueuedAudio();
  };

  useEffect(() => {
    onVoicePromptRef.current = onVoicePrompt;
  }, [onVoicePrompt]);

  useEffect(() => {
    setSupportsOutputSelection(
      typeof HTMLMediaElement !== "undefined" &&
        "setSinkId" in HTMLMediaElement.prototype
    );

    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    const syncDevices = async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const nextInputDevices = toDeviceOptions(devices, "audioinput");
      const nextOutputDevices = toDeviceOptions(devices, "audiooutput");

      setInputDevices(nextInputDevices);
      setOutputDevices(nextOutputDevices);
      setSelectedInputDeviceId((current) =>
        nextInputDevices.some((device) => device.id === current) ? current : ""
      );
      setSelectedOutputDeviceId((current) =>
        nextOutputDevices.some((device) => device.id === current) ? current : ""
      );
    };

    void syncDevices();
    navigator.mediaDevices.addEventListener("devicechange", syncDevices);

    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", syncDevices);
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const applyVoicePreferences = (preferences: PersistedVoicePreferences) => {
      setSelectedInputDeviceId(preferences.selectedInputDeviceId);
      setSelectedOutputDeviceId(preferences.selectedOutputDeviceId);
      setIsDeviceHintDismissed(preferences.deviceHintDismissed);
      setHasCompletedDeviceSetup(preferences.deviceSetupComplete);
    };

    void nativeApiRef.current!
      .getVoicePreferences()
      .then((preferences) => {
        if (isCancelled) {
          return;
        }

        applyVoicePreferences(preferences);
      })
      .catch(() => {
        // Default state is fine for prototype mode if persisted prefs are unavailable.
      })
      .finally(() => {
        if (!isCancelled) {
          setHasLoadedPreferences(true);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedPreferences) {
      return;
    }

    void nativeApiRef.current!
      .updateVoicePreferences({
        selectedInputDeviceId,
        selectedOutputDeviceId,
        deviceHintDismissed: isDeviceHintDismissed,
        deviceSetupComplete: hasCompletedDeviceSetup
      })
      .catch(() => {
        // Keep the live session responsive even if preference persistence fails.
      });
  }, [
    hasCompletedDeviceSetup,
    hasLoadedPreferences,
    isDeviceHintDismissed,
    selectedInputDeviceId,
    selectedOutputDeviceId
  ]);

  useEffect(() => {
    const playbackElement = playbackElementRef.current;

    if (!playbackElement?.setSinkId) {
      return;
    }

    void playbackElement.setSinkId(selectedOutputDeviceId);
  }, [selectedOutputDeviceId]);

const scheduleAudioPlayback = useEffectEvent(async (chunk: RealtimeAudioChunk) => {
    let decoded: ReturnType<typeof decodePcm16>;
    try {
      decoded = decodePcm16(chunk);
    } catch {
      // Realtime audio is untrusted input. Drop malformed chunks without breaking playback.
      return false;
    }
    const existingContext = playbackContextRef.current;
    const context = existingContext ?? new AudioContext({ sampleRate: decoded.sampleRate });

    if (!existingContext) {
      playbackContextRef.current = context;
      playbackDestinationRef.current = context.createMediaStreamDestination();
      const playbackElement = new Audio() as AudioOutputElement;
      playbackElement.autoplay = true;
      playbackElement.srcObject = playbackDestinationRef.current.stream;
      playbackElementRef.current = playbackElement;

      if (playbackElement.setSinkId) {
        await playbackElement.setSinkId(selectedOutputDeviceId);
      }
    }

    if (context.state === "suspended") {
      await context.resume();
    }

    if (playbackElementRef.current) {
      await playbackElementRef.current.play().catch(() => undefined);
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
    source.connect(playbackDestinationRef.current ?? context.destination);

    const startAt = Math.max(context.currentTime + 0.02, nextPlaybackTimeRef.current);
    source.start(startAt);
    nextPlaybackTimeRef.current = startAt + audioBuffer.duration;
    return true;
  });
  const scheduleAudioPlaybackRef = useRef(scheduleAudioPlayback);

  useEffect(() => {
    scheduleAudioPlaybackRef.current = scheduleAudioPlayback;
  }, [scheduleAudioPlayback]);

  useEffect(() => {
    void nativeApiRef.current!.getRealtimeState().then(setRealtimeState);
    const unsubscribe = nativeApiRef.current!.subscribeRealtimeEvents((event) => {
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
        void scheduleAudioPlaybackRef.current(event.audio).then((didPlay) => {
          if (didPlay) {
            setVoiceState("working");
          }
        });
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
            !dispatchedTranscriptIdsRef.current.has(nextEntry.id)
          ) {
            const normalizedPrompt = normalizePromptKey(nextEntry.text);

            if (normalizedPrompt !== lastDispatchedPromptRef.current) {
              rememberDispatchedTranscriptId(
                dispatchedTranscriptIdsRef.current,
                nextEntry.id
              );
              lastDispatchedPromptRef.current = normalizedPrompt;
              dispatchPrompt = nextEntry.text;
            }
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
    };
  }, []);

  const start = async () => {
    if (!enabled || isActive) {
      return;
    }

    setVoiceState("thinking");
    audioSendGenerationRef.current += 1;
    queuedAudioChunksRef.current = [];
    isSendingAudioRef.current = false;
    dispatchedTranscriptIdsRef.current.clear();
    lastDispatchedPromptRef.current = "";
    await nativeApiRef.current!.startRealtime();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: selectedInputDeviceId ? { exact: selectedInputDeviceId } : undefined,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      }
    });
    void navigator.mediaDevices.enumerateDevices().then((devices) => {
      setInputDevices(toDeviceOptions(devices, "audioinput"));
      setOutputDevices(toDeviceOptions(devices, "audiooutput"));
    });
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (event) => {
      const channel = event.inputBuffer.getChannelData(0);

      queueAudioChunk({
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
    setHasCompletedDeviceSetup(true);
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
    audioSendGenerationRef.current += 1;
    queuedAudioChunksRef.current = [];
    isSendingAudioRef.current = false;
    await closeAudioContext(captureContextRef.current);
    captureContextRef.current = null;
    playbackElementRef.current?.pause();
    playbackElementRef.current = null;
    playbackDestinationRef.current = null;
    await closeAudioContext(playbackContextRef.current);
    playbackContextRef.current = null;
    nextPlaybackTimeRef.current = 0;
    setIsActive(false);
    setLiveTranscript([]);
    dispatchedTranscriptIdsRef.current.clear();
    lastDispatchedPromptRef.current = "";
    setVoiceState("idle");

    try {
      await nativeApiRef.current!.stopRealtime();
    } catch {
      // Keep local teardown best-effort for prototype mode.
    }
  };

  const shouldShowDeviceHint = !isDeviceHintDismissed && !hasCompletedDeviceSetup;

  const resetVoicePreferences = async () => {
    const nextPreferences = await nativeApiRef.current!.resetVoicePreferences();
    setSelectedInputDeviceId(nextPreferences.selectedInputDeviceId);
    setSelectedOutputDeviceId(nextPreferences.selectedOutputDeviceId);
    setIsDeviceHintDismissed(nextPreferences.deviceHintDismissed);
    setHasCompletedDeviceSetup(nextPreferences.deviceSetupComplete);
    return nextPreferences;
  };

  return {
    voiceState,
    realtimeState,
    liveTranscript,
    inputDevices,
    outputDevices,
    selectedInputDeviceId,
    selectedOutputDeviceId,
    supportsOutputSelection,
    shouldShowDeviceHint,
    dismissDeviceHint: () => setIsDeviceHintDismissed(true),
    resetVoicePreferences,
    setSelectedInputDeviceId,
    setSelectedOutputDeviceId,
    isActive,
    start,
    stop
  };
};
