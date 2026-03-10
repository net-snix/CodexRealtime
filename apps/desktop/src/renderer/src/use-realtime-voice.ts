import { useEffect, useEffectEvent, useRef, useState } from "react";
import type {
  AudioDeviceOption,
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
  const dispatchedTranscriptIdsRef = useRef(new Set<string>());
  const lastDispatchedPromptRef = useRef("");
  const onVoicePromptRef = useRef(onVoicePrompt);

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

    void window.appBridge
      .getVoicePreferences()
      .then((preferences) => {
        if (isCancelled) {
          return;
        }

        setSelectedInputDeviceId(preferences.selectedInputDeviceId);
        setSelectedOutputDeviceId(preferences.selectedOutputDeviceId);
        setIsDeviceHintDismissed(preferences.deviceHintDismissed);
        setHasCompletedDeviceSetup(preferences.deviceSetupComplete);
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

    void window.appBridge
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
    const decoded = decodePcm16(chunk);
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
  });
  const scheduleAudioPlaybackRef = useRef(scheduleAudioPlayback);

  useEffect(() => {
    scheduleAudioPlaybackRef.current = scheduleAudioPlayback;
  }, [scheduleAudioPlayback]);

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
        void scheduleAudioPlaybackRef.current(event.audio);
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
    };
  }, []);

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
      await window.appBridge.stopRealtime();
    } catch {
      // Keep local teardown best-effort for prototype mode.
    }
  };

  const shouldShowDeviceHint = !isDeviceHintDismissed && !hasCompletedDeviceSetup;

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
    setSelectedInputDeviceId,
    setSelectedOutputDeviceId,
    isActive,
    start,
    stop
  };
};
