import type { AppBridge } from "@codex-realtime/contracts";

declare global {
  interface Window {
    appBridge: AppBridge;
  }
}

export {};
