import { useEffect, useRef, useState } from "react";
import type {
  PastedImageAttachment,
  WorkerAttachment,
  WorkerExecutionSettings,
  WorkerSettingsState
} from "@shared";
import { ensureNativeApi } from "./native-api";

const defaultSettings: WorkerExecutionSettings = {
  model: null,
  reasoningEffort: "high",
  fastMode: false,
  approvalPolicy: "untrusted",
  collaborationMode: "default"
};

const emptyState: WorkerSettingsState = {
  settings: defaultSettings,
  models: [],
  collaborationModes: []
};

const mergeAttachments = (
  current: WorkerAttachment[],
  next: WorkerAttachment[]
): WorkerAttachment[] => {
  const merged = new Map<string, WorkerAttachment>();

  for (const attachment of [...current, ...next]) {
    merged.set(attachment.path, attachment);
  }

  return [...merged.values()];
};

export function useWorkerSettings(contextKey: string | null) {
  const nativeApiRef = useRef<ReturnType<typeof ensureNativeApi> | null>(null);
  if (!nativeApiRef.current) {
    nativeApiRef.current = ensureNativeApi();
  }

  const [settingsState, setSettingsState] = useState<WorkerSettingsState>(emptyState);
  const [attachments, setAttachments] = useState<WorkerAttachment[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isPickingAttachments, setIsPickingAttachments] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void nativeApiRef.current!
      .getWorkerSettingsState()
      .then((nextState) => {
        if (!cancelled) {
          setSettingsState(nextState);
        }
      })
      .catch((error) => {
        console.error("Failed to load worker settings", error);
      });

    return () => {
      cancelled = true;
    };
  }, [contextKey]);

  useEffect(() => {
    setAttachments([]);
  }, [contextKey]);

  const updateSettings = async (patch: Partial<WorkerExecutionSettings>) => {
    setIsUpdating(true);

    try {
      const nextState = await nativeApiRef.current!.updateWorkerSettings(patch);
      setSettingsState(nextState);
      return nextState;
    } finally {
      setIsUpdating(false);
    }
  };

  const pickAttachments = async () => {
    setIsPickingAttachments(true);

    try {
      const picked = await nativeApiRef.current!.pickWorkerAttachments();

      if (picked.length === 0) {
        return [];
      }

      setAttachments((current) => mergeAttachments(current, picked));
      return picked;
    } finally {
      setIsPickingAttachments(false);
    }
  };

  const addAttachments = async (paths: string[]) => {
    if (paths.length === 0) {
      return [];
    }

    const added = await nativeApiRef.current!.addWorkerAttachments(paths);

    if (added.length === 0) {
      return [];
    }

    setAttachments((current) => mergeAttachments(current, added));
    return added;
  };

  const addPastedImageAttachments = async (images: PastedImageAttachment[]) => {
    if (images.length === 0) {
      return [];
    }

    const added = await nativeApiRef.current!.addPastedImageAttachments(images);

    if (added.length === 0) {
      return [];
    }

    setAttachments((current) => mergeAttachments(current, added));
    return added;
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  };

  const clearAttachments = () => {
    setAttachments([]);
  };

  return {
    settingsState,
    attachments,
    isUpdating,
    isPickingAttachments,
    updateSettings,
    pickAttachments,
    addAttachments,
    addPastedImageAttachments,
    removeAttachment,
    clearAttachments
  };
}
