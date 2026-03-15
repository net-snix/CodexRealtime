import { useEffect, useRef, useState } from "react";
import type { AppSettings, AppSettingsState } from "@shared";
import { ensureNativeApi } from "./native-api";

const emptyState: AppSettingsState = {
  settings: {
    launchAtLogin: false,
    restoreLastWorkspace: true,
    reopenLastThread: true,
    autoNameNewThreads: false,
    autoStartVoice: false,
    showVoiceCaptions: true,
    density: "comfortable",
    theme: "system",
    reduceMotion: false,
    desktopNotifications: true,
    notifyOnApprovals: true,
    notifyOnTurnComplete: true,
    notifyOnErrors: true,
    developerMode: false
  },
  userDataPath: "",
  loginItemSupported: false,
  notificationsSupported: false
};

export function useAppSettings() {
  const nativeApiRef = useRef<ReturnType<typeof ensureNativeApi> | null>(null);
  if (!nativeApiRef.current) {
    nativeApiRef.current = ensureNativeApi();
  }

  const [settingsState, setSettingsState] = useState<AppSettingsState>(emptyState);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void nativeApiRef.current!
      .getAppSettingsState()
      .then((nextState) => {
        if (!cancelled) {
          setSettingsState(nextState);
        }
      })
      .catch((error) => {
        console.error("Failed to load app settings", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const updateSettings = async (patch: Partial<AppSettings>) => {
    setIsUpdating(true);

    try {
      const nextState = await nativeApiRef.current!.updateAppSettings(patch);
      setSettingsState(nextState);
      return nextState;
    } finally {
      setIsUpdating(false);
    }
  };

  return {
    settingsState,
    isUpdating,
    updateSettings,
    setSettingsState
  };
}
