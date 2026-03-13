import { describe, expect, it, vi } from "vitest";
import { hasPastedAttachmentCandidates, readPastedAttachments } from "./pasted-attachments";

type ClipboardFile = Partial<File> & { path?: string };

type ClipboardStubOptions = {
  textPlain?: string;
  textUriList?: string;
  files?: ClipboardFile[];
};

const createClipboardStub = (options: ClipboardStubOptions = {}): DataTransfer => {
  const files = options.files ?? [];
  return {
    files,
    items: [],
    getData: (format: string) => {
      if (format === "text/plain") {
        return options.textPlain ?? "";
      }

      if (format === "text/uri-list") {
        return options.textUriList ?? "";
      }

      return "";
    }
  } as unknown as DataTransfer;
};

describe("pasted attachments", () => {
  it("accepts local file paths from clipboard text", () => {
    const clipboardData = createClipboardStub({
      textPlain: "/tmp/screenshot.png"
    });

    expect(hasPastedAttachmentCandidates(clipboardData)).toBe(true);
  });

  it("rejects clipboard text with control characters in paths", async () => {
    const clipboardData = createClipboardStub({
      textPlain: "/tmp/evil\u0000name.png"
    });

    expect(hasPastedAttachmentCandidates(clipboardData)).toBe(false);
    await expect(readPastedAttachments(clipboardData)).resolves.toEqual({
      paths: [],
      images: []
    });
  });

  it("rejects file URLs that decode to control characters", async () => {
    const clipboardData = createClipboardStub({
      textUriList: "file:///tmp/evil%00name.png"
    });

    expect(hasPastedAttachmentCandidates(clipboardData)).toBe(false);
    await expect(readPastedAttachments(clipboardData)).resolves.toEqual({
      paths: [],
      images: []
    });
  });

  it("deduplicates paths collected from files and text", async () => {
    const clipboardData = createClipboardStub({
      files: [{ path: "/tmp/a.png", type: "" }],
      textPlain: "/tmp/a.png\n/tmp/b.png"
    });

    await expect(readPastedAttachments(clipboardData)).resolves.toEqual({
      paths: ["/tmp/a.png", "/tmp/b.png"],
      images: []
    });
  });

  it("rejects clipboard file paths with control characters", async () => {
    const clipboardData = createClipboardStub({
      files: [{ path: "/tmp/evil\u0000name.png", type: "" }]
    });

    expect(hasPastedAttachmentCandidates(clipboardData)).toBe(false);
    await expect(readPastedAttachments(clipboardData)).resolves.toEqual({
      paths: [],
      images: []
    });
  });

  it("normalizes file URL clipboard file paths", async () => {
    const clipboardData = createClipboardStub({
      files: [{ path: "file:///tmp/photo.png", type: "" }]
    });

    await expect(readPastedAttachments(clipboardData)).resolves.toEqual({
      paths: ["/tmp/photo.png"],
      images: []
    });
  });

  it("accepts inline pasted image blobs within the size limit", async () => {
    const clipboardData = createClipboardStub({
      files: [
        {
          name: "paste.png",
          type: "image/png",
          size: 3,
          arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer
        }
      ]
    });

    expect(hasPastedAttachmentCandidates(clipboardData)).toBe(true);
    await expect(readPastedAttachments(clipboardData)).resolves.toEqual({
      paths: [],
      images: [
        {
          name: "paste.png",
          mimeType: "image/png",
          dataBase64: "AQID"
        }
      ]
    });
  });

  it("rejects oversized inline pasted image blobs before reading them", async () => {
    const arrayBuffer = vi.fn(async () => Uint8Array.from([1, 2, 3]).buffer);
    const clipboardData = createClipboardStub({
      files: [
        {
          name: "huge.png",
          type: "image/png",
          size: 10 * 1024 * 1024 + 1,
          arrayBuffer
        }
      ]
    });

    expect(hasPastedAttachmentCandidates(clipboardData)).toBe(false);
    await expect(readPastedAttachments(clipboardData)).resolves.toEqual({
      paths: [],
      images: []
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("rejects unsupported inline pasted image mime types before reading them", async () => {
    const arrayBuffer = vi.fn(async () => Uint8Array.from([1, 2, 3]).buffer);
    const clipboardData = createClipboardStub({
      files: [
        {
          name: "vector.svg",
          type: "image/svg+xml",
          size: 3,
          arrayBuffer
        }
      ]
    });

    expect(hasPastedAttachmentCandidates(clipboardData)).toBe(false);
    await expect(readPastedAttachments(clipboardData)).resolves.toEqual({
      paths: [],
      images: []
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
