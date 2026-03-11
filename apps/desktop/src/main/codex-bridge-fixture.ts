import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
  CodexFeatureFlags,
  SessionState,
  WorkerApprovalPolicy,
  WorkerCollaborationMode,
  WorkerReasoningEffort
} from "@shared";
import { buildAutoThreadName } from "./thread-auto-name";
import type { TurnRecord } from "./workspace-timeline";

type FixtureSession = {
  account?: {
    type?: "chatgpt" | "apiKey" | "unknown";
    email?: string;
    planType?: string;
  } | null;
  features?: Partial<CodexFeatureFlags>;
  requiresOpenaiAuth?: boolean;
};

type FixtureModel = {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  isDefault?: boolean;
  inputModalities?: string[];
  supportedReasoningEfforts?: Array<{
    reasoningEffort?: WorkerReasoningEffort;
  }>;
  defaultReasoningEffort?: WorkerReasoningEffort;
};

type FixtureConfig = {
  model?: string | null;
  model_reasoning_effort?: WorkerReasoningEffort | null;
  approval_policy?: WorkerApprovalPolicy | null;
  service_tier?: "fast" | "flex" | null;
};

type FixtureCollaborationMode = {
  name?: string | null;
  mode?: WorkerCollaborationMode | null;
  model?: string | null;
  reasoning_effort?: WorkerReasoningEffort | null;
};

type FixtureThread = {
  id: string;
  cwd: string;
  archived?: boolean;
  name?: string;
  preview?: string;
  updatedAt?: number;
  turns?: TurnRecord[];
};

type CodexBridgeFixtureData = {
  session?: FixtureSession;
  models?: FixtureModel[];
  config?: FixtureConfig;
  collaborationModes?: FixtureCollaborationMode[];
  threads?: FixtureThread[];
};

const DEFAULT_FEATURES: CodexFeatureFlags = {
  defaultModeRequestUserInput: true,
  realtimeConversation: true,
  voiceTranscription: true
};

const DEFAULT_MODELS: FixtureModel[] = [
  {
    id: "model-gpt-5.4",
    model: "gpt-5.4",
    displayName: "gpt-5.4",
    description: "Fixture default",
    isDefault: true,
    inputModalities: ["text", "image"],
    supportedReasoningEfforts: [
      { reasoningEffort: "low" },
      { reasoningEffort: "medium" },
      { reasoningEffort: "high" },
      { reasoningEffort: "xhigh" }
    ],
    defaultReasoningEffort: "xhigh"
  },
  {
    id: "model-gpt-5.3-codex",
    model: "gpt-5.3-codex",
    displayName: "gpt-5.3-codex",
    description: "Fixture alternate",
    inputModalities: ["text"],
    supportedReasoningEfforts: [
      { reasoningEffort: "low" },
      { reasoningEffort: "medium" },
      { reasoningEffort: "high" }
    ],
    defaultReasoningEffort: "high"
  }
];

const DEFAULT_CONFIG: FixtureConfig = {
  model: "gpt-5.4",
  model_reasoning_effort: "xhigh",
  approval_policy: "never",
  service_tier: "fast"
};

const DEFAULT_COLLABORATION_MODES: FixtureCollaborationMode[] = [
  {
    name: "Code",
    mode: "default",
    model: "gpt-5.4",
    reasoning_effort: "xhigh"
  },
  {
    name: "Plan",
    mode: "plan",
    model: "gpt-5.4",
    reasoning_effort: "xhigh"
  }
];

const nowSeconds = () => Math.floor(Date.now() / 1000);

const cloneTurns = (turns: TurnRecord[]) => structuredClone(turns);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

const getPromptFromInput = (input: unknown[]) => {
  for (const item of input) {
    if (
      isRecord(item) &&
      item.type === "text" &&
      typeof item.text === "string" &&
      item.text.trim()
    ) {
      return item.text.trim();
    }
  }

  return "Fixture task";
};

const buildFixtureSummaryPreview = (prompt: string) =>
  buildAutoThreadName(prompt, prompt) ?? prompt.trim();

export class CodexBridgeFixture {
  private readonly data: CodexBridgeFixtureData;

  constructor(fixturePath: string) {
    const raw = readFileSync(fixturePath, "utf8");
    this.data = JSON.parse(raw) as CodexBridgeFixtureData;
    this.data.threads ??= [];
  }

  refreshState(): SessionState {
    const session = this.data.session;

    return {
      status: "connected",
      account: session?.account
        ? {
            type: session.account.type ?? "chatgpt",
            email: session.account.email,
            planType: session.account.planType
          }
        : {
            type: "chatgpt",
            planType: "pro"
          },
      features: {
        ...DEFAULT_FEATURES,
        ...(session?.features ?? {})
      },
      requiresOpenaiAuth: session?.requiresOpenaiAuth ?? false,
      error: null,
      lastUpdatedAt: new Date().toISOString()
    };
  }

  startThread(cwd: string) {
    const id = `fixture-thread-${randomUUID()}`;
    this.data.threads!.unshift({
      id,
      cwd,
      archived: false,
      name: "New thread",
      preview: "New thread",
      updatedAt: nowSeconds(),
      turns: []
    });

    return {
      thread: {
        id
      }
    };
  }

  resumeThread(threadId: string, cwd: string) {
    void cwd;
    return {
      thread: {
        id: threadId
      }
    };
  }

  listThreads(cwd: string, archived = false) {
    return {
      data: this.data.threads!
        .filter((thread) => thread.cwd === cwd && Boolean(thread.archived) === archived)
        .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
        .map((thread) => ({
          id: thread.id,
          name: thread.name ?? thread.preview ?? "Untitled thread",
          preview: thread.preview ?? thread.name ?? "Untitled thread",
          updatedAt: thread.updatedAt ?? nowSeconds()
        }))
    };
  }

  archiveThread(threadId: string) {
    const thread = this.getThread(threadId);
    thread.archived = true;
    thread.updatedAt = nowSeconds();
    return {};
  }

  unarchiveThread(threadId: string) {
    const thread = this.getThread(threadId);
    thread.archived = false;
    thread.updatedAt = nowSeconds();
    return {};
  }

  readThread(threadId: string) {
    const thread = this.getThread(threadId);
    return {
      thread: {
        id: thread.id,
        turns: cloneTurns(thread.turns ?? [])
      }
    };
  }

  listModels() {
    return {
      data: this.data.models ?? DEFAULT_MODELS
    };
  }

  readConfig() {
    return {
      config: this.data.config ?? DEFAULT_CONFIG
    };
  }

  getConversationSummary(threadId: string) {
    const thread = this.getThread(threadId);
    const prompt = thread.preview ?? thread.name ?? "New thread";

    return {
      summary: {
        conversationId: thread.id,
        path: thread.id,
        preview: buildFixtureSummaryPreview(prompt),
        timestamp: null,
        updatedAt: new Date((thread.updatedAt ?? nowSeconds()) * 1000).toISOString(),
        modelProvider: "fixture",
        cwd: thread.cwd,
        cliVersion: "fixture",
        source: "cli",
        gitInfo: null
      }
    };
  }

  setThreadName(threadId: string, name: string) {
    const thread = this.getThread(threadId);
    thread.name = name;
    thread.preview = name;
    thread.updatedAt = nowSeconds();
    return {};
  }

  listCollaborationModes() {
    return {
      data: this.data.collaborationModes ?? DEFAULT_COLLABORATION_MODES
    };
  }

  startTurn(threadId: string, input: unknown[], settings: unknown, resolvedModel: string | null) {
    void settings;
    void resolvedModel;
    const thread = this.getThread(threadId);
    const prompt = getPromptFromInput(input);
    const turnId = `fixture-turn-${randomUUID()}`;
    const turns = thread.turns ?? [];

    turns.push({
      id: turnId,
      status: "inProgress",
      items: [
        {
          type: "userMessage",
          content: [
            {
              type: "text",
              text: prompt
            }
          ]
        },
        {
          type: "agentMessage",
          text: `Working on ${prompt}`
        }
      ]
    });

    thread.turns = turns;
    thread.name = thread.name === "New thread" ? prompt : thread.name;
    thread.preview = prompt;
    thread.updatedAt = nowSeconds();

    return {
      turn: {
        id: turnId
      }
    };
  }

  steerTurn(threadId: string, expectedTurnId: string, prompt: string) {
    const thread = this.getThread(threadId);
    const activeTurn = (thread.turns ?? []).find((turn) => turn.id === expectedTurnId);

    if (activeTurn) {
      activeTurn.items ??= [];
      activeTurn.items.push({
        type: "userMessage",
        content: [
          {
            type: "text",
            text: prompt
          }
        ]
      });
      thread.updatedAt = nowSeconds();
    }

    return {
      turn: {
        id: expectedTurnId
      }
    };
  }

  interruptTurn(threadId: string, turnId: string) {
    const thread = this.getThread(threadId);
    const activeTurn = (thread.turns ?? []).find((turn) => turn.id === turnId);

    if (activeTurn) {
      activeTurn.status = "interrupted";
      thread.updatedAt = nowSeconds();
    }

    return {};
  }

  startRealtime(threadId: string, _prompt: string, sessionId?: string | null) {
    return {
      threadId,
      sessionId: sessionId ?? `fixture-realtime-${randomUUID()}`
    };
  }

  appendRealtimeAudio() {
    return {};
  }

  appendRealtimeText() {
    return {};
  }

  stopRealtime() {
    return {};
  }

  respond() {
    return {};
  }

  private getThread(threadId: string) {
    const thread = this.data.threads!.find((entry) => entry.id === threadId);

    if (!thread) {
      throw new Error(`Fixture thread not found: ${threadId}`);
    }

    return thread;
  }
}
