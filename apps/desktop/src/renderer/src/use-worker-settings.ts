import { useEffect, useState } from "react";
import type {
  WorkerAttachment,
  WorkerExecutionSettings,
  WorkerSettingsState
} from "@shared";

const defaultSettings: WorkerExecutionSettings = {
  model: null,
  reasoningEffort: "high",
  fastMode: false,
  approvalPolicy: "untrusted"
};

const emptyState: WorkerSettingsState = {
  settings: defaultSettings,
  models: []
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
  const [settingsState, setSettingsState] = useState<WorkerSettingsState>(emptyState);
  const [attachments, setAttachments] = useState<WorkerAttachment[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isPickingAttachments, setIsPickingAttachments] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void window.appBridge
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
      const nextState = await window.appBridge.updateWorkerSettings(patch);
      setSettingsState(nextState);
      return nextState;
    } finally {
      setIsUpdating(false);
    }
  };

  const pickAttachments = async () => {
    setIsPickingAttachments(true);

    try {
      const picked = await window.appBridge.pickWorkerAttachments();

      if (picked.length === 0) {
        return [];
      }

      setAttachments((current) => mergeAttachments(current, picked));
      return picked;
    } finally {
      setIsPickingAttachments(false);
    }
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
    removeAttachment,
    clearAttachments
  };
}
