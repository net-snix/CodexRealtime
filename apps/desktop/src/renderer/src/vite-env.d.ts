/// <reference types="vite/client" />

import type { NativeApi } from "@codex-realtime/contracts";

declare global {
  interface Window {
    nativeApi: NativeApi;
  }
}

export {};
