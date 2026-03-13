import { describe, expect, it } from "vitest";
import {
  buildPastedImageFileName,
  estimateBase64DecodedBytes,
  getPastedImageFileExtension,
  isSupportedPastedImageMimeType,
  MAX_PASTED_IMAGE_BASE64_LENGTH
} from "./pasted-image-limits";

describe("pasted image limits", () => {
  it("whitelists supported pasted image mime types", () => {
    expect(isSupportedPastedImageMimeType(" IMAGE/PNG ")).toBe(true);
    expect(isSupportedPastedImageMimeType("image/svg+xml")).toBe(false);
    expect(getPastedImageFileExtension("image/webp")).toBe(".webp");
    expect(getPastedImageFileExtension("image/svg+xml")).toBeNull();
  });

  it("builds canonical pasted image file names", () => {
    expect(buildPastedImageFileName(" Screenshot.final!!.jpeg ", "image/png")).toBe(
      "Screenshot.final.png"
    );
    expect(buildPastedImageFileName("   ", "image/webp")).toBe("pasted-image.webp");
  });

  it("keeps the base64 size math in one place", () => {
    expect(MAX_PASTED_IMAGE_BASE64_LENGTH).toBe(Math.ceil((10 * 1024 * 1024) / 3) * 4);
    expect(estimateBase64DecodedBytes("AQID")).toBe(3);
    expect(estimateBase64DecodedBytes("AQI=")).toBe(2);
    expect(estimateBase64DecodedBytes("AQ==")).toBe(1);
  });
});
