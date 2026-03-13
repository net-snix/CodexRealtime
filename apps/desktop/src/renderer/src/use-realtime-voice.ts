import { useEffect, useEffectEvent, useRef, useState } from "react";
import type {
  AudioDeviceOption,
  RealtimeAudioChunk,
  RealtimeState,
  RealtimeTranscriptEntry,
  VoiceIntent,
  VoiceState
} from "@shared";
import { ensureNativeApi, type NativeApi } from "./native-api";
import {
  normalizeVoiceDispatchKey,
  parseRealtimeVoiceItem,
  shouldDelayVoiceIntent
} from "./realtime-voice-intents";

const initialRealtimeState: RealtimeState = {
  status: "idle",
  threadId: null,
  sessionId: null,
  error: null
};

const TRANSCRIPT_LIMIT = 6;
const MAX_QUEUED_AUDIO_CHUNKS = 4;
const MAX_VOICE_INTENT_RECORDS = 128;
const PCM16_BASE64_CHUNK_SIZE = 0x8000;
const MIN_AUDIO_SAMPLE_RATE = 8_000;
const MAX_AUDIO_SAMPLE_RATE = 192_000;
const MAX_AUDIO_CHANNELS = 8;
const MAX_PCM16_BYTES_PER_CHUNK = 8 * 1024 * 1024;
const MAX_SAMPLES_PER_CHANNEL = 262_144;
const MESSAGE_WORK_REQUEST_DELAY_MS = 160;

type PersistedVoicePreferences = Awaited<ReturnType<NativeApi["getVoicePreferences"]>>;
type AudioOutputElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

const upsertTranscriptEntry = (
  entries: RealtimeTranscriptEntry[],
  nextEntry: RealtimeTranscriptEntry,
  {
    allowReplace = true,
    matchEntryIds = [],
    matchNormalizedText = null
  }: {
    allowReplace?: boolean;
    matchEntryIds?: string[];
    matchNormalizedText?: string | null;
  } = {}
) => {
  let existingIndex = entries.findIndex((entry) => entry.id === nextEntry.id);

  if (existingIndex < 0 && matchEntryIds.length > 0 && nextEntry.speaker === "user") {
    existingIndex = entries.findIndex(
      (entry) =>
        entry.speaker === "user" && matchEntryIds.includes(entry.id)
    );
  }

  if (existingIndex < 0 && matchNormalizedText && nextEntry.speaker === "user") {
    existingIndex = entries.findIndex(
      (entry) =>
        entry.speaker === "user" &&
        normalizeVoiceDispatchKey(entry.text) === matchNormalizedText
    );
  }

  if (existingIndex >= 0) {
    if (!allowReplace) {
      return entries.slice(-TRANSCRIPT_LIMIT);
    }

    const nextEntries = [...entries];
    nextEntries[existingIndex] = nextEntry;
    return nextEntries.slice(-TRANSCRIPT_LIMIT);
  }

  return [...entries, nextEntry].slice(-TRANSCRIPT_LIMIT);
};

type VoiceIntentDispatchRecord = {
  primaryKey: string;
  aliases: Set<string>;
  intent: VoiceIntent;
  transcriptEntry: RealtimeTranscriptEntry;
  richness: number;
  dispatched: boolean;
  timeoutId: ReturnType<typeof window.setTimeout> | null;
};

const findDispatchRecord = (
  records: Map<string, VoiceIntentDispatchRecord>,
  aliasToPrimary: Map<string, string>,
  keys: string[]
) => {
  for (const key of keys) {
    const primaryKey = aliasToPrimary.get(key) ?? key;
    const record = records.get(primaryKey);

    if (record) {
      return record;
    }
  }

  return null;
};

const registerRecordAliases = (
  aliasToPrimary: Map<string, string>,
  record: VoiceIntentDispatchRecord,
  keys: string[]
) => {
  for (const key of keys) {
    aliasToPrimary.set(key, record.primaryKey);
    record.aliases.add(key);
  }
};

const promoteDispatchRecordPrimaryKey = (
  records: Map<string, VoiceIntentDispatchRecord>,
  aliasToPrimary: Map<string, string>,
  record: VoiceIntentDispatchRecord,
  nextPrimaryKey: string
) => {
  if (record.primaryKey === nextPrimaryKey) {
    return;
  }

  records.delete(record.primaryKey);
  record.primaryKey = nextPrimaryKey;
  records.set(nextPrimaryKey, record);

  for (const alias of record.aliases) {
    aliasToPrimary.set(alias, nextPrimaryKey);
  }
};

const clearDispatchRecords = (
  records: Map<string, VoiceIntentDispatchRecord>,
  aliasToPrimary: Map<string, string>
) => {
  for (const record of records.values()) {
    if (record.timeoutId !== null) {
      clearTimeout(record.timeoutId);
    }
  }

  records.clear();
  aliasToPrimary.clear();
};

const trimDispatchRecords = (
  records: Map<string, VoiceIntentDispatchRecord>,
  aliasToPrimary: Map<string, string>
) => {
  while (records.size > MAX_VOICE_INTENT_RECORDS) {
    const oldestPrimaryKey = records.keys().next().value;

    if (typeof oldestPrimaryKey !== "string") {
      return;
    }

    const record = records.get(oldestPrimaryKey);
    if (record?.timeoutId != null) {
      clearTimeout(record.timeoutId);
    }

    records.delete(oldestPrimaryKey);

    for (const alias of record?.aliases ?? []) {
      aliasToPrimary.delete(alias);
    }
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
  onVoiceIntent
}: {
  enabled: boolean;
  onVoiceIntent?: (intent: VoiceIntent) => void | Promise<void>;
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
  const liveTranscriptRef = useRef<RealtimeTranscriptEntry[]>([]);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextPlaybackTimeRef = useRef(0);
  const queuedAudioChunksRef = useRef<RealtimeAudioChunk[]>([]);
  const isSendingAudioRef = useRef(false);
  const audioSendGenerationRef = useRef(0);
  const dispatchedVoiceIntentsRef = useRef(new Map<string, VoiceIntentDispatchRecord>());
  const dispatchedVoiceIntentAliasesRef = useRef(new Map<string, string>());
  const onVoiceIntentRef = useRef(onVoiceIntent);

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
    onVoiceIntentRef.current = onVoiceIntent;
  }, [onVoiceIntent]);

  useEffect(() => {
    liveTranscriptRef.current = liveTranscript;
  }, [liveTranscript]);

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
        const nextItem = parseRealtimeVoiceItem(event.item, liveTranscriptRef.current.length + 1);
        let transcriptMatchEntryIds: string[] = [];
        let transcriptMatchNormalizedText: string | null = null;
        let allowTranscriptReplace = true;

        if (!nextItem) {
          return;
        }

        let dispatchIntent: VoiceIntent | null = null;
        let nextTranscriptEntry = nextItem.transcriptEntry;
        nextEntrySpeaker = nextItem.transcriptEntry.speaker;

        if (nextItem.intent && nextItem.dedupeKeys.length > 0) {
          const existing = findDispatchRecord(
            dispatchedVoiceIntentsRef.current,
            dispatchedVoiceIntentAliasesRef.current,
            nextItem.dedupeKeys
          );
          const primaryKey = existing?.primaryKey ?? nextItem.dedupeKeys[0]!;
          transcriptMatchEntryIds = Array.from(new Set([primaryKey, ...nextItem.dedupeKeys]));

          if (existing) {
            const previousRichness = existing.richness;
            const isTranscriptUpgrade = nextItem.richness > previousRichness;
            const isTranscriptDowngrade = nextItem.richness < previousRichness;

            if (!isTranscriptUpgrade) {
              nextTranscriptEntry = {
                ...nextItem.transcriptEntry,
                id: primaryKey
              };
            }

            allowTranscriptReplace = !isTranscriptDowngrade;
            registerRecordAliases(
              dispatchedVoiceIntentAliasesRef.current,
              existing,
              nextItem.dedupeKeys
            );
            if (nextItem.richness > previousRichness) {
              promoteDispatchRecordPrimaryKey(
                dispatchedVoiceIntentsRef.current,
                dispatchedVoiceIntentAliasesRef.current,
                existing,
                nextItem.dedupeKeys[0] ?? existing.primaryKey
              );
              nextTranscriptEntry = {
                ...nextItem.transcriptEntry,
                id: existing.primaryKey
              };
              existing.intent = nextItem.intent;
              existing.transcriptEntry = nextTranscriptEntry;
              existing.richness = nextItem.richness;
            } else if (nextItem.richness < previousRichness) {
              nextTranscriptEntry = existing.transcriptEntry;
            } else {
              existing.intent = nextItem.intent;
              existing.transcriptEntry = nextTranscriptEntry;
            }

            if (
              !existing.dispatched &&
              nextItem.richness > previousRichness &&
              existing.timeoutId !== null
            ) {
              clearTimeout(existing.timeoutId);
              existing.timeoutId = null;
              existing.dispatched = true;
              dispatchIntent = nextItem.intent;
            }
          } else {
            const record: VoiceIntentDispatchRecord = {
              primaryKey,
              aliases: new Set(),
              intent: nextItem.intent,
              transcriptEntry: nextTranscriptEntry,
              richness: nextItem.richness,
              dispatched: false,
              timeoutId: null
            };
            registerRecordAliases(
              dispatchedVoiceIntentAliasesRef.current,
              record,
              nextItem.dedupeKeys
            );
            dispatchedVoiceIntentsRef.current.set(primaryKey, record);
            trimDispatchRecords(
              dispatchedVoiceIntentsRef.current,
              dispatchedVoiceIntentAliasesRef.current
            );

            if (shouldDelayVoiceIntent(nextItem.intent)) {
              record.timeoutId = window.setTimeout(() => {
                record.timeoutId = null;
                if (record.dispatched) {
                  return;
                }

                record.dispatched = true;
                void onVoiceIntentRef.current?.(record.intent);
              }, MESSAGE_WORK_REQUEST_DELAY_MS);
            } else {
              record.dispatched = true;
              dispatchIntent = nextItem.intent;
            }
          }

          if (nextItem.intent.source.sourceType === "handoff_request") {
            transcriptMatchNormalizedText = normalizeVoiceDispatchKey(
              nextItem.intent.source.transcript
            );
          }
        }

        setLiveTranscript((current) => {
          const nextTranscript = upsertTranscriptEntry(
            current,
            nextTranscriptEntry,
            {
              allowReplace: allowTranscriptReplace,
              matchEntryIds: transcriptMatchEntryIds,
              matchNormalizedText: transcriptMatchNormalizedText
            }
          );
          liveTranscriptRef.current = nextTranscript;
          return nextTranscript;
        });

        if (nextEntrySpeaker) {
          setVoiceState(nextEntrySpeaker === "assistant" ? "working" : "thinking");
        }

        if (dispatchIntent) {
          void onVoiceIntentRef.current?.(dispatchIntent);
        }
        return;
      }

      if (event.type === "error") {
        setVoiceState("error");
      }
    });

    return () => {
      clearDispatchRecords(
        dispatchedVoiceIntentsRef.current,
        dispatchedVoiceIntentAliasesRef.current
      );
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
    clearDispatchRecords(
      dispatchedVoiceIntentsRef.current,
      dispatchedVoiceIntentAliasesRef.current
    );
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
    clearDispatchRecords(
      dispatchedVoiceIntentsRef.current,
      dispatchedVoiceIntentAliasesRef.current
    );
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
