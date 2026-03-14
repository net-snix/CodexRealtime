import { useCallback, useEffect, useMemo, useState } from "react";
import { EDITORS, type EditorId } from "@codex-realtime/contracts";
import type { NativeApi } from "./native-api";

const LAST_EDITOR_KEY = "codex-realtime:last-editor";
const fallbackStorage = new Map<string, string>();

const isEditorId = (value: string | null): value is EditorId =>
  Boolean(value) && EDITORS.some((editor) => editor.id === value);

const readStorageValue = (key: string): string | null => {
  if (typeof window !== "undefined") {
    const storage = window.localStorage;
    if (storage && typeof storage.getItem === "function") {
      try {
        return storage.getItem(key);
      } catch {
        // Ignore storage access issues and fall back to memory.
      }
    }
  }

  return fallbackStorage.get(key) ?? null;
};

const writeStorageValue = (key: string, value: string) => {
  if (typeof window !== "undefined") {
    const storage = window.localStorage;
    if (storage && typeof storage.setItem === "function") {
      try {
        storage.setItem(key, value);
        fallbackStorage.set(key, value);
        return;
      } catch {
        // Ignore storage access issues and fall back to memory.
      }
    }
  }

  fallbackStorage.set(key, value);
};

const readStoredPreferredEditor = (): EditorId | null => {
  const storedValue = readStorageValue(LAST_EDITOR_KEY);
  return isEditorId(storedValue) ? storedValue : null;
};

const persistPreferredEditor = (editor: EditorId) => {
  writeStorageValue(LAST_EDITOR_KEY, editor);
};

export const resolveAndPersistPreferredEditor = (
  availableEditors: readonly EditorId[]
): EditorId | null => {
  const availableEditorIds = new Set(availableEditors);
  const stored = readStoredPreferredEditor();

  if (stored && availableEditorIds.has(stored)) {
    return stored;
  }

  const fallback = EDITORS.find((editor) => availableEditorIds.has(editor.id))?.id ?? null;

  if (fallback) {
    persistPreferredEditor(fallback);
  }

  return fallback;
};

export const usePreferredEditor = (availableEditors: readonly EditorId[]) => {
  const availableEditorsKey = useMemo(() => availableEditors.join("|"), [availableEditors]);
  const [preferredEditor, setPreferredEditorState] = useState<EditorId | null>(() =>
    resolveAndPersistPreferredEditor(availableEditors)
  );

  useEffect(() => {
    setPreferredEditorState(resolveAndPersistPreferredEditor(availableEditors));
  }, [availableEditorsKey, availableEditors]);

  const setPreferredEditor = useCallback(
    (editor: EditorId) => {
      if (!availableEditors.includes(editor)) {
        return;
      }

      persistPreferredEditor(editor);
      setPreferredEditorState(editor);
    },
    [availableEditors]
  );

  return [preferredEditor, setPreferredEditor] as const;
};

export const openInPreferredEditor = async (
  api: NativeApi,
  targetPath: string,
  availableEditors: readonly EditorId[]
): Promise<EditorId> => {
  const editor = resolveAndPersistPreferredEditor(availableEditors);

  if (!editor) {
    throw new Error("No available editors found.");
  }

  await api.openInEditor(targetPath, editor);
  return editor;
};

export const resetEditorPreferencesForTests = () => {
  fallbackStorage.clear();

  if (typeof window === "undefined") {
    return;
  }

  const storage = window.localStorage;
  if (storage && typeof storage.removeItem === "function") {
    try {
      storage.removeItem(LAST_EDITOR_KEY);
    } catch {
      // Ignore storage access issues in tests.
    }
  }
};
