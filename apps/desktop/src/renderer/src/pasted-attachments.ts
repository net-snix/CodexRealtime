import {
  type PastedImageAttachment
} from "@shared";
import {
  buildPastedImageFileName,
  getPastedImageFileExtension,
  isPastedImageByteLengthWithinLimit
} from "../../pasted-image-limits";

type FileWithPath = File & {
  path?: string;
};

type PastedAttachments = {
  paths: string[];
  images: PastedImageAttachment[];
};

const CONTROL_PATH_CHARS = /[\u0000-\u001f\u007f]/;
const MAX_LOCAL_PATH_LENGTH = 4096;

const sanitizeLocalPath = (value: string) => {
  if (!value || CONTROL_PATH_CHARS.test(value) || value.length > MAX_LOCAL_PATH_LENGTH) {
    return null;
  }

  return value;
};

const isPasteableInlineImageFile = (file: File) =>
  getPastedImageFileExtension(file.type) !== null && isPastedImageByteLengthWithinLimit(file.size);

const normalizeFileUrlPath = (value: string) => {
  try {
    const url = new URL(value);

    if (url.protocol !== "file:") {
      return null;
    }

    const pathname = decodeURIComponent(url.pathname);
    const normalizedPath = /^\/[A-Za-z]:/.test(pathname) ? pathname.slice(1) : pathname;
    return sanitizeLocalPath(normalizedPath);
  } catch {
    return null;
  }
};

const normalizeLocalPath = (value: string) => {
  const trimmedValue = value.trim();

  if (!trimmedValue || trimmedValue.startsWith("#")) {
    return null;
  }

  if (CONTROL_PATH_CHARS.test(trimmedValue)) {
    return null;
  }

  if (trimmedValue.startsWith("file://")) {
    return normalizeFileUrlPath(trimmedValue);
  }

  if (trimmedValue.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmedValue)) {
    return sanitizeLocalPath(trimmedValue);
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
  if (typeof path !== "string") {
    return null;
  }

  return normalizeLocalPath(path);
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
  if (!isPasteableInlineImageFile(file)) {
    return null;
  }

  const arrayBuffer = await file.arrayBuffer();

  if (!isPastedImageByteLengthWithinLimit(arrayBuffer.byteLength)) {
    return null;
  }

  const mimeType = file.type.trim().toLowerCase();
  const fallbackExtension = getPastedImageFileExtension(mimeType);

  if (!fallbackExtension) {
    return null;
  }

  const name = buildPastedImageFileName(
    file.name?.trim() || `pasted-image-${fallbackIndex + 1}`,
    mimeType
  );

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

const getClipboardFileEntries = (clipboardData: DataTransfer) =>
  getClipboardFiles(clipboardData).map((file) => ({
    file,
    filePath: getClipboardFilePath(file)
  }));

export const hasPastedAttachmentCandidates = (clipboardData: DataTransfer | null) => {
  if (!clipboardData) {
    return false;
  }

  const uriListPaths = collectTextPaths(clipboardData.getData("text/uri-list"));
  if (uriListPaths.length > 0) {
    return true;
  }

  const plainTextPaths = collectTextPaths(clipboardData.getData("text/plain"));
  if (plainTextPaths.length > 0) {
    return true;
  }

  const fileEntries = getClipboardFileEntries(clipboardData);
  return fileEntries.some(({ file, filePath }) => {
    return Boolean(filePath) || isPasteableInlineImageFile(file);
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

  const fileEntries = getClipboardFileEntries(clipboardData);
  const paths = new Set<string>();

  for (const { filePath } of fileEntries) {
    if (filePath) {
      paths.add(filePath);
    }
  }

  const uriListPaths = collectTextPaths(clipboardData.getData("text/uri-list"));
  for (const path of uriListPaths) {
    paths.add(path);
  }

  const plainTextPaths = collectTextPaths(clipboardData.getData("text/plain"));
  for (const path of plainTextPaths) {
    paths.add(path);
  }

  const imageFiles = fileEntries
    .filter(({ file, filePath }) => !filePath && isPasteableInlineImageFile(file))
    .map(({ file }) => file);
  const images = (
    await Promise.all(imageFiles.map((file, index) => toPastedImageAttachment(file, index)))
  ).filter((image): image is PastedImageAttachment => Boolean(image));

  return {
    paths: [...paths],
    images
  };
};
