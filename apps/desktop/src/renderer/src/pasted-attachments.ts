import type { PastedImageAttachment } from "@shared";

type FileWithPath = File & {
  path?: string;
};

type PastedAttachments = {
  paths: string[];
  images: PastedImageAttachment[];
};

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff"
};

const normalizeFileUrlPath = (value: string) => {
  try {
    const url = new URL(value);

    if (url.protocol !== "file:") {
      return null;
    }

    const pathname = decodeURIComponent(url.pathname);
    return /^\/[A-Za-z]:/.test(pathname) ? pathname.slice(1) : pathname;
  } catch {
    return null;
  }
};

const normalizeLocalPath = (value: string) => {
  const trimmedValue = value.trim();

  if (!trimmedValue || trimmedValue.startsWith("#")) {
    return null;
  }

  if (trimmedValue.startsWith("file://")) {
    return normalizeFileUrlPath(trimmedValue);
  }

  if (trimmedValue.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmedValue)) {
    return trimmedValue;
  }

  return null;
};

const collectTextPaths = (value: string) => {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const normalized = lines
    .map(normalizeLocalPath)
    .filter((path): path is string => Boolean(path));

  return normalized.length === lines.length ? normalized : [];
};

const getClipboardFilePath = (file: File | null) => {
  const path = file && "path" in file ? (file as FileWithPath).path : null;
  return typeof path === "string" && path.trim() ? path : null;
};

const getClipboardFileIdentity = (file: File) => {
  const filePath = getClipboardFilePath(file);

  if (filePath) {
    return `path:${filePath}`;
  }

  return `blob:${file.name}:${file.type}:${file.size}:${file.lastModified}`;
};

const encodeBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let index = 0; index < bytes.length; index += 0x8000) {
    const chunk = bytes.subarray(index, index + 0x8000);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
};

const toPastedImageAttachment = async (
  file: File,
  fallbackIndex: number
): Promise<PastedImageAttachment | null> => {
  const mimeType = file.type.trim().toLowerCase();

  if (!mimeType.startsWith("image/")) {
    return null;
  }

  const arrayBuffer = await file.arrayBuffer();

  if (arrayBuffer.byteLength === 0) {
    return null;
  }

  const fallbackExtension = IMAGE_EXTENSIONS[mimeType] ?? ".png";
  const name = file.name?.trim() || `pasted-image-${fallbackIndex + 1}${fallbackExtension}`;

  return {
    name,
    mimeType,
    dataBase64: encodeBase64(arrayBuffer)
  };
};

const getClipboardFiles = (clipboardData: DataTransfer) => {
  const files: File[] = [];
  const seenFiles = new Set<string>();

  for (const file of Array.from(clipboardData.files ?? [])) {
    seenFiles.add(getClipboardFileIdentity(file));
    files.push(file);
  }

  for (const item of Array.from(clipboardData.items ?? [])) {
    if (item.kind !== "file") {
      continue;
    }

    const file = item.getAsFile();

    if (!file) {
      continue;
    }

    const fileIdentity = getClipboardFileIdentity(file);

    if (seenFiles.has(fileIdentity)) {
      continue;
    }

    seenFiles.add(fileIdentity);
    files.push(file);
  }

  return files;
};

export const hasPastedAttachmentCandidates = (clipboardData: DataTransfer | null) => {
  if (!clipboardData) {
    return false;
  }

  if (collectTextPaths(clipboardData.getData("text/uri-list")).length > 0) {
    return true;
  }

  if (collectTextPaths(clipboardData.getData("text/plain")).length > 0) {
    return true;
  }

  return getClipboardFiles(clipboardData).some((file) => {
    const filePath = getClipboardFilePath(file);
    return Boolean(filePath) || file.type.trim().toLowerCase().startsWith("image/");
  });
};

export const readPastedAttachments = async (
  clipboardData: DataTransfer | null
): Promise<PastedAttachments> => {
  if (!clipboardData) {
    return {
      paths: [],
      images: []
    };
  }

  const paths = new Set<string>();

  for (const file of getClipboardFiles(clipboardData)) {
    const filePath = getClipboardFilePath(file);

    if (filePath) {
      paths.add(filePath);
    }
  }

  for (const path of collectTextPaths(clipboardData.getData("text/uri-list"))) {
    paths.add(path);
  }

  for (const path of collectTextPaths(clipboardData.getData("text/plain"))) {
    paths.add(path);
  }

  const imageFiles = getClipboardFiles(clipboardData).filter(
    (file) => !getClipboardFilePath(file) && file.type.trim().toLowerCase().startsWith("image/")
  );
  const images = (
    await Promise.all(imageFiles.map((file, index) => toPastedImageAttachment(file, index)))
  ).filter((image): image is PastedImageAttachment => Boolean(image));

  return {
    paths: [...paths],
    images
  };
};
