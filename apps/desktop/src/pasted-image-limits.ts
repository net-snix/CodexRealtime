export const MAX_PASTED_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PASTED_IMAGE_BASE64_LENGTH = Math.ceil(MAX_PASTED_IMAGE_BYTES / 3) * 4;

const PASTED_IMAGE_EXTENSION_BY_MIME_TYPE = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff"
} as const;

type SupportedPastedImageMimeType = keyof typeof PASTED_IMAGE_EXTENSION_BY_MIME_TYPE;

const normalizePastedImageMimeType = (mimeType: string) => mimeType.trim().toLowerCase();

export const isPastedImageByteLengthWithinLimit = (byteLength: number) =>
  Number.isFinite(byteLength) && byteLength > 0 && byteLength <= MAX_PASTED_IMAGE_BYTES;

export const isSupportedPastedImageMimeType = (
  mimeType: string
): mimeType is SupportedPastedImageMimeType =>
  Object.hasOwn(PASTED_IMAGE_EXTENSION_BY_MIME_TYPE, normalizePastedImageMimeType(mimeType));

export const getPastedImageFileExtension = (mimeType: string) => {
  const normalizedMimeType = normalizePastedImageMimeType(mimeType);

  if (!isSupportedPastedImageMimeType(normalizedMimeType)) {
    return null;
  }

  return PASTED_IMAGE_EXTENSION_BY_MIME_TYPE[normalizedMimeType];
};

export const estimateBase64DecodedBytes = (value: string) => {
  if (!value) {
    return 0;
  }

  let paddingBytes = 0;

  if (value.endsWith("==")) {
    paddingBytes = 2;
  } else if (value.endsWith("=")) {
    paddingBytes = 1;
  }

  return Math.floor((value.length * 3) / 4) - paddingBytes;
};

export const buildPastedImageFileName = (name: string, mimeType: string) => {
  const extension = getPastedImageFileExtension(mimeType) ?? ".png";
  const sanitizedBaseName = name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/\.+/g, ".");
  const baseNameWithoutExtension = sanitizedBaseName
    .replace(/\.[A-Za-z0-9]+$/, "")
    .replace(/[.-]+$/g, "");
  const fileNameBase = baseNameWithoutExtension || "pasted-image";

  return `${fileNameBase}${extension}`;
};
