import type { AppBridge, NativeApi } from "@codex-realtime/contracts";

declare global {
  interface Window {
    appBridge: AppBridge;
    nativeApi: NativeApi;
  }
}

export {};
