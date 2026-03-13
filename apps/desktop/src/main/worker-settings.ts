import { basename, extname } from "node:path";
import type {
  VoiceTaskEnvelope,
  WorkerAttachment,
  WorkerApprovalPolicy,
  WorkerCollaborationMode,
  WorkerCollaborationModeOption,
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

type RawConfig = {
  model?: string | null;
  model_reasoning_effort?: WorkerReasoningEffort | null;
  approval_policy?: WorkerApprovalPolicy | null;
  service_tier?: "fast" | "flex" | null;
};

type RawCollaborationMode = {
  name?: string | null;
  mode?: WorkerCollaborationMode | null;
  model?: string | null;
  reasoning_effort?: WorkerReasoningEffort | null;
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
export const DEFAULT_WORKER_COLLABORATION_MODES: WorkerCollaborationModeOption[] = [
  {
    mode: "default",
    label: "Code",
    name: "Code",
    model: null,
    reasoningEffort: null
  },
  {
    mode: "plan",
    label: "Plan",
    name: "Plan",
    model: null,
    reasoningEffort: null
  }
];

export const DEFAULT_WORKER_SETTINGS: WorkerExecutionSettings = {
  model: null,
  reasoningEffort: FALLBACK_REASONING_EFFORT,
  fastMode: false,
  approvalPolicy: "untrusted",
  collaborationMode: "default"
};

export const normalizeWorkerSettings = (
  value: Partial<WorkerExecutionSettings> | null | undefined
): WorkerExecutionSettings => ({
  model: typeof value?.model === "string" && value.model.trim() ? value.model : null,
  reasoningEffort: value?.reasoningEffort ?? FALLBACK_REASONING_EFFORT,
  fastMode: Boolean(value?.fastMode),
  approvalPolicy: value?.approvalPolicy ?? "untrusted",
  collaborationMode: value?.collaborationMode === "plan" ? "plan" : "default"
});

export const workerSettingsFromConfig = (
  value: RawConfig | null | undefined
): WorkerExecutionSettings =>
  normalizeWorkerSettings({
    model: value?.model ?? null,
    reasoningEffort: value?.model_reasoning_effort ?? FALLBACK_REASONING_EFFORT,
    approvalPolicy: value?.approval_policy ?? "untrusted",
    fastMode: value?.service_tier === "fast",
    collaborationMode: "default"
  });

export const mapWorkerCollaborationMode = (
  value: RawCollaborationMode
): WorkerCollaborationModeOption | null => {
  const mode = value.mode === "plan" || value.mode === "default" ? value.mode : null;

  if (!mode) {
    return null;
  }

  const displayLabel = mode === "plan" ? "Plan" : "Code";
  const name =
    mode === "plan"
      ? "Plan"
      : typeof value.name === "string" && value.name.trim()
        ? value.name.trim()
        : displayLabel;

  return {
    mode,
    label: displayLabel,
    name,
    model: typeof value.model === "string" && value.model.trim() ? value.model : null,
    reasoningEffort: value.reasoning_effort ?? null
  };
};

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
  const selectedModel = getSelectedWorkerModel(settings, models);
  const supportedReasoningEfforts =
    selectedModel?.supportedReasoningEfforts.length
      ? selectedModel.supportedReasoningEfforts
      : ([FALLBACK_REASONING_EFFORT] as WorkerReasoningEffort[]);
  const reasoningEffort = supportedReasoningEfforts.includes(settings.reasoningEffort)
    ? settings.reasoningEffort
    : selectedModel?.defaultReasoningEffort ?? FALLBACK_REASONING_EFFORT;

  return {
    model: settings.model,
    reasoningEffort,
    fastMode: settings.fastMode,
    approvalPolicy: settings.approvalPolicy,
    collaborationMode: settings.collaborationMode
  };
};

export const getSelectedWorkerModel = (
  settings: WorkerExecutionSettings,
  models: WorkerModelOption[]
) => {
  const defaultModel = models.find((entry) => entry.isDefault) ?? models[0] ?? null;

  if (!settings.model) {
    return defaultModel;
  }

  return (
    models.find((entry) => entry.model === settings.model || entry.id === settings.model) ??
    defaultModel
  );
};

export const supportsImageAttachments = (
  modelName: string | null,
  models: WorkerModelOption[]
) => {
  return Boolean(
    models.find((entry) => entry.model === modelName || entry.id === modelName)?.supportsImageInput
  );
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

export const buildVoiceTaskPrompt = (envelope: VoiceTaskEnvelope) => {
  const sections = [
    "Structured voice handoff",
    `Source: ${envelope.source}`,
    `Source item id: ${envelope.sourceItemId ?? "unknown"}`,
    `Handoff id: ${envelope.handoffId ?? "unknown"}`,
    `Transcript: ${envelope.transcript}`,
    `User goal: ${envelope.userGoal}`,
    `Distilled prompt: ${envelope.distilledPrompt}`,
    envelope.constraints.length > 0
      ? `Constraints:\n${envelope.constraints.map((constraint) => `- ${constraint}`).join("\n")}`
      : null,
    envelope.acceptanceCriteria.length > 0
      ? `Acceptance criteria:\n${envelope.acceptanceCriteria
          .map((criterion) => `- ${criterion}`)
          .join("\n")}`
      : null,
    `Clarification policy: ${envelope.clarificationPolicy}`,
    `Reply style: ${envelope.replyStyle}`,
    `Workspace id: ${envelope.workspaceId ?? "unknown"}`,
    `Thread id: ${envelope.threadId ?? "unknown"}`
  ];

  return sections.filter((section): section is string => Boolean(section)).join("\n\n");
};

export const buildVoiceTaskInputs = (
  envelope: VoiceTaskEnvelope,
  attachments: WorkerAttachment[],
  canSendImages: boolean
) => buildWorkerInputs(buildVoiceTaskPrompt(envelope), attachments, canSendImages);

export const toWorkerAttachment = (path: string): WorkerAttachment => ({
  id: path,
  name: basename(path),
  path,
  kind: isImagePath(path) ? "image" : "file"
});
