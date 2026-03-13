export const MAX_PASTED_IMAGE_BYTES = 10 * 1024 * 1024;

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
