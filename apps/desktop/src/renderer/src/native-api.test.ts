// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import type { NativeApi } from "@codex-realtime/contracts";
import {
  ensureNativeApi,
  readNativeApi,
  resetNativeApiCacheForTests
} from "./native-api";

afterEach(() => {
  resetNativeApiCacheForTests();
  Reflect.deleteProperty(window as Window & { nativeApi?: NativeApi }, "nativeApi");
});

describe("native-api", () => {
  it("reads the canonical native API from preload", () => {
    const firstBridge = { getAppInfo: async () => null } as unknown as NativeApi;
    (window as Window & { nativeApi?: NativeApi }).nativeApi = firstBridge;

    expect(readNativeApi()).toBe(firstBridge);
    expect(ensureNativeApi()).toBe(firstBridge);
  });

  it("refreshes when tests replace the preload bridge object", () => {
    const firstBridge = { getAppInfo: async () => null } as unknown as NativeApi;
    const secondBridge = { getAppInfo: async () => "next" } as unknown as NativeApi;

    (window as Window & { nativeApi?: NativeApi }).nativeApi = firstBridge;
    expect(readNativeApi()).toBe(firstBridge);

    (window as Window & { nativeApi?: NativeApi }).nativeApi = secondBridge;
    expect(readNativeApi()).toBe(secondBridge);
  });

  it("throws when no native API is available", () => {
    expect(() => ensureNativeApi()).toThrow("Native API not found");
  });
});
