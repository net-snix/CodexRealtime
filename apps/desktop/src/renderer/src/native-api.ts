import type { NativeApi as NativeApiContract } from "@codex-realtime/contracts";
export type NativeApi = NativeApiContract;

type RendererWindow = Window & {
  nativeApi?: NativeApiContract;
};

let cachedApi: NativeApiContract | undefined;

export const readNativeApi = (): NativeApiContract | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  const rendererWindow = window as RendererWindow;
  const nextApi = rendererWindow.nativeApi;

  if (!nextApi) {
    cachedApi = undefined;
    return undefined;
  }

  if (cachedApi === nextApi) {
    return cachedApi;
  }

  cachedApi = nextApi;
  return cachedApi;
};

export const ensureNativeApi = (): NativeApiContract => {
  const api = readNativeApi();

  if (!api) {
    throw new Error("Native API not found");
  }

  return api;
};

export const resetNativeApiCacheForTests = () => {
  cachedApi = undefined;
};
