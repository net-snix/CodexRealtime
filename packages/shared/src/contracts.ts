export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}

export interface AppBridge {
  getAppInfo: () => Promise<AppInfo>;
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
