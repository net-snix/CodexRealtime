import { basename, extname } from "node:path";
import type {
  WorkerAttachment,
  WorkerExecutionSettings,
  WorkerModelOption,
  WorkerReasoningEffort
} from "@shared";

type RawModel = {
  id?: string;
  model?: string;
  displayName?: string;
  description?: string;
  isDefault?: boolean;
  inputModalities?: string[];
  supportedReasoningEfforts?: Array<{
    reasoningEffort?: WorkerReasoningEffort;
  }>;
  defaultReasoningEffort?: WorkerReasoningEffort;
};

type WorkerInputItem =
  | {
      type: "text";
      text: string;
      text_elements: [];
    }
  | {
      type: "localImage";
      path: string;
    }
  | {
      type: "mention";
      name: string;
      path: string;
    };

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
  ".svg"
]);

export const FALLBACK_REASONING_EFFORT: WorkerReasoningEffort = "high";

export const DEFAULT_WORKER_SETTINGS: WorkerExecutionSettings = {
  model: null,
  reasoningEffort: FALLBACK_REASONING_EFFORT,
  fastMode: false,
  approvalPolicy: "untrusted"
};

export const normalizeWorkerSettings = (
  value: Partial<WorkerExecutionSettings> | null | undefined
): WorkerExecutionSettings => ({
  model: typeof value?.model === "string" && value.model.trim() ? value.model : null,
  reasoningEffort: value?.reasoningEffort ?? FALLBACK_REASONING_EFFORT,
  fastMode: Boolean(value?.fastMode),
  approvalPolicy: value?.approvalPolicy ?? "untrusted"
});

export const mapWorkerModel = (model: RawModel): WorkerModelOption | null => {
  if (!model.id || !model.model || !model.displayName) {
    return null;
  }

  const supportedReasoningEfforts = (model.supportedReasoningEfforts ?? [])
    .map((entry) => entry.reasoningEffort)
    .filter((value): value is WorkerReasoningEffort => Boolean(value));

  return {
    id: model.id,
    model: model.model,
    label: model.displayName,
    description: model.description ?? "",
    isDefault: Boolean(model.isDefault),
    supportsImageInput: (model.inputModalities ?? []).includes("image"),
    supportedReasoningEfforts,
    defaultReasoningEffort:
      model.defaultReasoningEffort ??
      supportedReasoningEfforts[0] ??
      FALLBACK_REASONING_EFFORT
  };
};

export const resolveWorkerSettings = (
  settings: WorkerExecutionSettings,
  models: WorkerModelOption[]
): WorkerExecutionSettings => {
  const defaultModel = models.find((entry) => entry.isDefault) ?? models[0] ?? null;
  const selectedModel =
    models.find((entry) => entry.model === settings.model || entry.id === settings.model) ??
    defaultModel;
  const supportedReasoningEfforts =
    selectedModel?.supportedReasoningEfforts.length
      ? selectedModel.supportedReasoningEfforts
      : ([FALLBACK_REASONING_EFFORT] as WorkerReasoningEffort[]);
  const reasoningEffort = supportedReasoningEfforts.includes(settings.reasoningEffort)
    ? settings.reasoningEffort
    : selectedModel?.defaultReasoningEffort ?? FALLBACK_REASONING_EFFORT;

  return {
    model: selectedModel?.model ?? settings.model,
    reasoningEffort,
    fastMode: settings.fastMode,
    approvalPolicy: settings.approvalPolicy
  };
};

export const supportsImageAttachments = (
  modelName: string | null,
  models: WorkerModelOption[]
) => {
  if (!modelName) {
    return false;
  }

  return models.some((entry) => entry.model === modelName && entry.supportsImageInput);
};

export const isImagePath = (value: string) =>
  IMAGE_EXTENSIONS.has(extname(value).toLowerCase());

export const buildWorkerInputs = (
  prompt: string,
  attachments: WorkerAttachment[],
  canSendImages: boolean
): WorkerInputItem[] => {
  const attachmentItems = attachments.map<WorkerInputItem>((attachment) => {
    if (attachment.kind === "image" && canSendImages) {
      return {
        type: "localImage",
        path: attachment.path
      };
    }

    return {
      type: "mention",
      name: attachment.name,
      path: attachment.path
    };
  });

  return [
    ...attachmentItems,
    {
      type: "text",
      text: prompt,
      text_elements: []
    }
  ];
};

export const toWorkerAttachment = (path: string): WorkerAttachment => ({
  id: path,
  name: basename(path),
  path,
  kind: isImagePath(path) ? "image" : "file"
});
