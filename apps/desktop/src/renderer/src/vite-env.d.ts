/// <reference types="vite/client" />

import type { AppBridge } from "@shared";

declare global {
  interface Window {
    appBridge: AppBridge;
  }
}

export {};
