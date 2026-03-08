export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}

export interface CodexAccountSummary {
  type: "chatgpt" | "apiKey" | "unknown";
  email?: string;
  planType?: string;
}

export interface CodexFeatureFlags {
  defaultModeRequestUserInput: boolean;
  realtimeConversation: boolean;
  voiceTranscription: boolean;
}

export interface SessionState {
  status: "connecting" | "connected" | "error";
  account: CodexAccountSummary | null;
  features: CodexFeatureFlags;
  requiresOpenaiAuth: boolean;
  error: string | null;
  lastUpdatedAt: string | null;
}

export interface AppBridge {
  getAppInfo: () => Promise<AppInfo>;
  getSessionState: () => Promise<SessionState>;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  path: string;
}

export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export type VoiceState =
  | "idle"
  | "listening"
  | "thinking"
  | "working"
  | "approval"
  | "error";

export interface TimelineEvent {
  id: string;
  kind: "user" | "assistant" | "commentary" | "system";
  text: string;
  createdAt: string;
}
