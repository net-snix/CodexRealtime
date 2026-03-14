// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEditorPreferencesForTests } from "../editor-preferences";
import type { NativeApi } from "../native-api";
import { TimelineRichText } from "./TimelineRichText";

describe("TimelineRichText", () => {
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

  it("opens markdown file links in the preferred editor", async () => {
    await act(async () => {
      root?.render(
        <TimelineRichText
          text={"Open [App](/Users/espenmac/Code/CodexRealtime/apps/desktop/src/renderer/src/App.tsx#L12)"}
          cwd="/Users/espenmac/Code/CodexRealtime"
          availableEditors={["vscode"]}
        />
      );
    });

    const link = container?.querySelector("a") as HTMLAnchorElement | null;
    expect(link?.textContent).toBe("App");

    await act(async () => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(openInEditor).toHaveBeenCalledWith(
      "/Users/espenmac/Code/CodexRealtime/apps/desktop/src/renderer/src/App.tsx:12",
      "vscode"
    );
  });

  it("keeps external links as normal anchors", async () => {
    await act(async () => {
      root?.render(
        <TimelineRichText text={"Read [docs](https://example.com/docs)"} availableEditors={["vscode"]} />
      );
    });

    const link = container?.querySelector("a") as HTMLAnchorElement | null;
    expect(link?.getAttribute("href")).toBe("https://example.com/docs");
    expect(link?.getAttribute("target")).toBe("_blank");
  });
});
