export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}

export interface AudioDeviceOption {
  id: string;
  label: string;
}

export interface VoicePreferences {
  selectedInputDeviceId: string;
  selectedOutputDeviceId: string;
  deviceHintDismissed: boolean;
  deviceSetupComplete: boolean;
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
  getWorkspaceState: () => Promise<WorkspaceState>;
  openWorkspace: () => Promise<WorkspaceState>;
  getTimelineState: () => Promise<TimelineState>;
  startTurn: (prompt: string) => Promise<TimelineState>;
  dispatchVoicePrompt: (prompt: string) => Promise<TimelineState>;
  interruptActiveTurn: () => Promise<TimelineState>;
  respondToApproval: (
    requestId: string,
    decision: ApprovalDecision
  ) => Promise<TimelineState>;
  submitUserInput: (
    requestId: string,
    answers: Record<string, string | string[]>
  ) => Promise<TimelineState>;
  getRealtimeState: () => Promise<RealtimeState>;
  startRealtime: (prompt?: string) => Promise<RealtimeState>;
  stopRealtime: () => Promise<RealtimeState>;
  appendRealtimeAudio: (audio: RealtimeAudioChunk) => Promise<void>;
  appendRealtimeText: (text: string) => Promise<void>;
  getVoicePreferences: () => Promise<VoicePreferences>;
  updateVoicePreferences: (
    preferences: Partial<VoicePreferences>
  ) => Promise<VoicePreferences>;
  subscribeRealtimeEvents: (listener: RealtimeEventListener) => () => void;
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

export interface WorkspaceState {
  currentWorkspace: WorkspaceSummary | null;
  recentWorkspaces: WorkspaceSummary[];
  threads: ThreadSummary[];
}

export interface TimelineState {
  threadId: string | null;
  events: TimelineEvent[];
  planSteps: TimelinePlanStep[];
  diff: string;
  approvals: TimelineApproval[];
  userInputs: TimelineUserInputRequest[];
  isRunning: boolean;
  statusLabel: string | null;
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

export interface TimelinePlanStep {
  step: string;
  status: string;
}

export interface TimelineApproval {
  id: string;
  kind: "command" | "fileChange";
  title: string;
  detail: string;
  availableDecisions: ApprovalDecision[];
  isSubmitting: boolean;
}

export interface TimelineUserInputRequest {
  id: string;
  title: string;
  questions: TimelineUserInputQuestion[];
  isSubmitting: boolean;
}

export interface TimelineUserInputQuestion {
  id: string;
  header: string;
  question: string;
  isSecret: boolean;
  options: TimelineUserInputOption[];
}

export interface TimelineUserInputOption {
  label: string;
  description: string;
}

export type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export interface RealtimeAudioChunk {
  data: string;
  sampleRate: number;
  numChannels: number;
  samplesPerChannel: number | null;
}

export interface RealtimeState {
  status: "idle" | "connecting" | "live" | "error";
  threadId: string | null;
  sessionId: string | null;
  error: string | null;
}

export interface RealtimeTranscriptEntry {
  id: string;
  speaker: "user" | "assistant" | "system";
  text: string;
  status: "partial" | "final";
  createdAt: string;
}

export type RealtimeEvent =
  | { type: "state"; state: RealtimeState }
  | { type: "audio"; audio: RealtimeAudioChunk }
  | { type: "item"; item: unknown }
  | { type: "error"; message: string };

export type RealtimeEventListener = (event: RealtimeEvent) => void;
