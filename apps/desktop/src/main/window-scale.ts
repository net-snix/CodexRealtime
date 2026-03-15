import { BrowserWindow } from "electron";
import type { AppSettings } from "@shared";

export const WINDOW_SCALE_OPTIONS: AppSettings["windowScale"][] = [25, 50, 100, 150, 200] as const;

export const applyWindowScaleToWindow = (window: BrowserWindow, windowScale: AppSettings["windowScale"]) => {
  const zoomFactor = windowScale / 100;
  window.webContents.setZoomFactor(zoomFactor);
};

export const applyWindowScaleToWindows = (windowScale: AppSettings["windowScale"]) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue;
    }

    applyWindowScaleToWindow(window, windowScale);
  }
};

export const getWindowScaleIndex = (value: AppSettings["windowScale"]) =>
  WINDOW_SCALE_OPTIONS.indexOf(value);
