import { useEffect, useRef, useState } from "react";
import type { VoiceApiKeyState } from "@shared";
import { ensureNativeApi, type NativeApi } from "./native-api";

const emptyState: VoiceApiKeyState = {
  configured: false,
  status: "missing",
  lastValidatedAt: null,
  error: null
};

export const useVoiceApiKey = () => {
  const nativeApiRef = useRef<NativeApi | null>(null);
  if (!nativeApiRef.current) {
    nativeApiRef.current = ensureNativeApi();
  }

  const [state, setState] = useState<VoiceApiKeyState>(emptyState);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void nativeApiRef.current!
      .getVoiceApiKeyState()
      .then((nextState) => {
        if (!cancelled) {
          setState(nextState);
        }
      })
      .catch(() => {
        // Keep a safe empty state if voice key state cannot be loaded.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const saveApiKey = async (apiKey: string) => {
    setIsSaving(true);

    try {
      const nextState = await nativeApiRef.current!.setVoiceApiKey(apiKey);
      setState(nextState);
      return nextState;
    } finally {
      setIsSaving(false);
    }
  };

  const clearApiKey = async () => {
    setIsClearing(true);

    try {
      const nextState = await nativeApiRef.current!.clearVoiceApiKey();
      setState(nextState);
      return nextState;
    } finally {
      setIsClearing(false);
    }
  };

  const testApiKey = async () => {
    setIsTesting(true);

    try {
      const nextState = await nativeApiRef.current!.testVoiceApiKey();
      setState(nextState);
      return nextState;
    } finally {
      setIsTesting(false);
    }
  };

  return {
    state,
    isSaving,
    isTesting,
    isClearing,
    saveApiKey,
    clearApiKey,
    testApiKey
  };
};
