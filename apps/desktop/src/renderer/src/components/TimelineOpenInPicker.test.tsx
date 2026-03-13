// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEditorPreferencesForTests } from "../editor-preferences";
import type { NativeApi } from "../native-api";
import { TimelineOpenInPicker } from "./TimelineOpenInPicker";

describe("TimelineOpenInPicker", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  const openInEditor = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    resetEditorPreferencesForTests();
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "MacIntel"
    });
    (window as Window & { nativeApi?: NativeApi }).nativeApi = {
      openInEditor
    } as unknown as NativeApi;
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }

    openInEditor.mockReset();
    resetEditorPreferencesForTests();
    container?.remove();
    container = null;
    root = null;
    Reflect.deleteProperty(window as Window & { nativeApi?: NativeApi }, "nativeApi");
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("opens the workspace in the default preferred editor", async () => {
    await act(async () => {
      root?.render(
        <TimelineOpenInPicker
          availableEditors={["vscode", "file-manager"]}
          openInCwd="/Users/espenmac/Code/CodexRealtime"
        />
      );
    });

    const openButton = container?.querySelector(".timeline-open-trigger") as HTMLButtonElement | null;
    expect(openButton?.textContent).toContain("VS Code");

    await act(async () => {
      openButton?.click();
    });

    expect(openInEditor).toHaveBeenCalledWith("/Users/espenmac/Code/CodexRealtime", "vscode");
  });

  it("lets the user switch the preferred editor from the dropdown", async () => {
    await act(async () => {
      root?.render(
        <TimelineOpenInPicker
          availableEditors={["vscode", "file-manager"]}
          openInCwd="/Users/espenmac/Code/CodexRealtime"
        />
      );
    });

    const menuButton = container?.querySelector(
      ".timeline-open-trigger-menu"
    ) as HTMLButtonElement | null;

    await act(async () => {
      menuButton?.click();
    });

    const finderOption = Array.from(
      container?.querySelectorAll(".timeline-open-menu-item") ?? []
    ).find((node) => node.textContent?.includes("Finder")) as HTMLButtonElement | undefined;

    await act(async () => {
      finderOption?.click();
    });

    const openButton = container?.querySelector(".timeline-open-trigger") as HTMLButtonElement | null;
    expect(openButton?.textContent).toContain("Finder");

    await act(async () => {
      openButton?.click();
    });

    expect(openInEditor).toHaveBeenLastCalledWith("/Users/espenmac/Code/CodexRealtime", "file-manager");
  });
});
