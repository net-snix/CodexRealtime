import { useEffect, useMemo, useRef, useState } from "react";
import { EDITORS, type EditorId } from "@codex-realtime/contracts";
import { openInPreferredEditor, usePreferredEditor } from "../editor-preferences";
import { readNativeApi } from "../native-api";

type TimelineOpenInPickerProps = {
  availableEditors: readonly EditorId[];
  openInCwd: string | null;
};

const isMacPlatform = (platform: string) => platform.toLowerCase().includes("mac");
const isWindowsPlatform = (platform: string) => platform.toLowerCase().includes("win");

const resolveEditorLabel = (editorId: EditorId, platform: string) => {
  if (editorId !== "file-manager") {
    return EDITORS.find((editor) => editor.id === editorId)?.label ?? editorId;
  }

  if (isMacPlatform(platform)) {
    return "Finder";
  }

  if (isWindowsPlatform(platform)) {
    return "Explorer";
  }

  return "Files";
};

export function TimelineOpenInPicker({
  availableEditors,
  openInCwd
}: TimelineOpenInPickerProps) {
  const [preferredEditor, setPreferredEditor] = usePreferredEditor(availableEditors);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  const options = useMemo(
    () =>
      EDITORS.filter((editor) => availableEditors.includes(editor.id)).map((editor) => ({
        value: editor.id,
        label: resolveEditorLabel(editor.id, platform)
      })),
    [availableEditors, platform]
  );
  const primaryLabel =
    options.find((option) => option.value === preferredEditor)?.label ?? "Open";

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;

      if (target instanceof Node && containerRef.current?.contains(target)) {
        return;
      }

      setIsOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const handleOpenWorkspace = () => {
    const api = readNativeApi();

    if (!api || !openInCwd || availableEditors.length === 0) {
      return;
    }

    void openInPreferredEditor(api, openInCwd, availableEditors).catch((error) => {
      console.warn("Unable to open workspace in editor.", error);
    });
  };

  const handleSelectEditor = (editor: EditorId) => {
    setPreferredEditor(editor);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="timeline-open-picker">
      <button
        type="button"
        className="timeline-open-trigger"
        disabled={!preferredEditor || !openInCwd}
        onClick={handleOpenWorkspace}
        title={preferredEditor ? `Open in ${primaryLabel}` : "No editor available"}
      >
        <span>{primaryLabel}</span>
      </button>
      <button
        type="button"
        className={`timeline-open-trigger timeline-open-trigger-menu${
          isOpen ? " timeline-open-trigger-open" : ""
        }`}
        aria-label="Choose editor"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="timeline-open-trigger-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {isOpen ? (
        <div className="timeline-open-menu" role="menu" aria-label="Editor choices">
          {options.length === 0 ? (
            <div className="timeline-open-menu-empty">No installed editors found</div>
          ) : (
            options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={option.value === preferredEditor}
                className={`timeline-open-menu-item${
                  option.value === preferredEditor ? " timeline-open-menu-item-active" : ""
                }`}
                onClick={() => handleSelectEditor(option.value)}
              >
                <span>{option.label}</span>
                {option.value === preferredEditor ? (
                  <span className="timeline-open-menu-check" aria-hidden="true">
                    ✓
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
