export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}

export type AppDensity = "comfortable" | "compact";
export type AppTheme = "light" | "dark" | "system";

export interface AppSettings {
  launchAtLogin: boolean;
  restoreLastWorkspace: boolean;
  reopenLastThread: boolean;
  autoNameNewThreads: boolean;
  autoStartVoice: boolean;
  showVoiceCaptions: boolean;
  density: AppDensity;
  theme: AppTheme;
  reduceMotion: boolean;
  desktopNotifications: boolean;
  notifyOnApprovals: boolean;
  notifyOnTurnComplete: boolean;
  notifyOnErrors: boolean;
  developerMode: boolean;
}

export interface AppSettingsState {
  settings: AppSettings;
  userDataPath: string;
  loginItemSupported: boolean;
  notificationsSupported: boolean;
}

export interface DesktopNotificationRequest {
  title: string;
  body: string;
}

export interface AudioDeviceOption {
  id: string;
  label: string;
}

export interface VoicePreferences {
  mode: VoiceMode;
  speakAgentActivity: boolean;
  speakToolCalls: boolean;
  speakPlanUpdates: boolean;
  selectedInputDeviceId: string;
  selectedOutputDeviceId: string;
  deviceHintDismissed: boolean;
  deviceSetupComplete: boolean;
}

export type VoiceMode = "transcription" | "realtime";

export type VoiceApiKeyStatus = "missing" | "valid" | "invalid";

export interface VoiceApiKeyState {
  configured: boolean;
  status: VoiceApiKeyStatus;
  lastValidatedAt: string | null;
  error: string | null;
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

export interface WorkspaceSummary {
  id: string;
  name: string;
  path: string;
}

export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
  preview: string | null;
  changeSummary: ThreadChangeSummary | null;
  state: ThreadState;
  isRunning: boolean;
  hasPendingApproval: boolean;
  hasPendingUserInput: boolean;
}

export type ThreadState = "idle" | "running" | "approval" | "input";

export interface ThreadChangeSummary {
  additions: number;
  deletions: number;
}

export interface WorkspaceProject {
  id: string;
  name: string;
  path: string;
  isCurrent: boolean;
  currentThreadId: string | null;
  threads: ThreadSummary[];
}

export interface WorkspaceState {
  currentWorkspace: WorkspaceSummary | null;
  currentThreadId: string | null;
  recentWorkspaces: WorkspaceSummary[];
  threads: ThreadSummary[];
  projects: WorkspaceProject[];
  archivedProjects: WorkspaceProject[];
}

export type WorkerReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export type WorkerApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";
export type WorkerCollaborationMode = "default" | "plan";

export interface WorkerExecutionSettings {
  model: string | null;
  reasoningEffort: WorkerReasoningEffort;
  fastMode: boolean;
  approvalPolicy: WorkerApprovalPolicy;
  collaborationMode: WorkerCollaborationMode;
}

export interface WorkerModelOption {
  id: string;
  model: string;
  label: string;
  description: string;
  isDefault: boolean;
  supportsImageInput: boolean;
  supportedReasoningEfforts: WorkerReasoningEffort[];
  defaultReasoningEffort: WorkerReasoningEffort;
}

export interface WorkerCollaborationModeOption {
  mode: WorkerCollaborationMode;
  label: string;
  name: string;
  model: string | null;
  reasoningEffort: WorkerReasoningEffort | null;
}

export interface WorkerSettingsState {
  settings: WorkerExecutionSettings;
  models: WorkerModelOption[];
  collaborationModes: WorkerCollaborationModeOption[];
}

export interface WorkerAttachment {
  id: string;
  name: string;
  path: string;
  kind: "file" | "image";
}

export interface PastedImageAttachment {
  name: string;
  mimeType: string;
  dataBase64: string;
}

export interface TurnStartRequest {
  prompt: string;
  attachments: WorkerAttachment[];
}

export interface TimelineState {
  threadId: string | null;
  entries: TimelineEntry[];
  activePlan: TimelinePlan | null;
  latestProposedPlan: TimelinePlan | null;
  turnDiffs: TimelineDiffEntry[];
  activeDiffPreview: TimelineDiffEntry | null;
  approvals: TimelineApproval[];
  userInputs: TimelineUserInputRequest[];
  isRunning: boolean;
  runState: TimelineRunState;
  activeWorkStartedAt: string | null;
  latestTurn: TimelineTurn | null;
}

export interface TimelineRunState {
  phase:
    | "idle"
    | "starting"
    | "running"
    | "steering"
    | "waitingApproval"
    | "waitingUserInput"
    | "interrupted"
    | "failed"
    | "historyUnavailable";
  label: string | null;
}

export type TimelineEntry =
  | TimelineMessageEntry
  | TimelineActivityEntry
  | TimelineProposedPlanEntry
  | TimelineDiffEntry;

export interface TimelineTurn {
  id: string;
  status: "completed" | "interrupted" | "failed" | "inProgress";
  startedAt: string | null;
  completedAt: string | null;
}

export interface TimelineMessageEntry {
  id: string;
  kind: "message";
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  completedAt: string | null;
  turnId: string | null;
  summary: string | null;
  isStreaming: boolean;
  providerLabel: string | null;
}

export type TimelineActivityType =
  | "reasoning"
  | "command_execution"
  | "mcp_tool_call"
  | "dynamic_tool_call"
  | "collab_agent_tool_call"
  | "web_search"
  | "image_view"
  | "plan_update"
  | "review_entered"
  | "review_exited"
  | "context_compaction"
  | "error"
  | "unknown";

export type TimelineActivityStatus =
  | "in_progress"
  | "completed"
  | "failed"
  | "declined"
  | null;

export interface TimelineActivityEntry {
  id: string;
  kind: "activity";
  activityType: TimelineActivityType;
  createdAt: string;
  turnId: string | null;
  tone: "thinking" | "tool" | "info" | "error";
  label: string;
  detail: string | null;
  command: string | null;
  changedFiles: TimelineChangedFile[];
  status: TimelineActivityStatus;
  toolName: string | null;
  agentLabel: string | null;
}

export interface TimelinePlan {
  id: string;
  createdAt: string;
  updatedAt: string | null;
  turnId: string | null;
  title: string;
  text: string;
  steps: TimelinePlanStep[];
}

export interface TimelineProposedPlanEntry extends TimelinePlan {
  kind: "proposedPlan";
}

export type TimelinePlanEntry = TimelineProposedPlanEntry;

export interface TimelineChangedFile {
  path: string;
  additions: number;
  deletions: number;
  diff: string | null;
}

export interface TimelineDiffEntry {
  id: string;
  kind: "diffSummary";
  createdAt: string;
  turnId: string | null;
  assistantMessageId: string | null;
  title: string;
  diff: string;
  files: TimelineChangedFile[];
  additions: number;
  deletions: number;
}

export type TimelineWorkEntry = TimelineActivityEntry;

export interface ArchiveThreadResult {
  timelineState: TimelineState;
  workspaceId: string;
  archivedThreadId: string;
  selectedThreadId: string | null;
}

export type VoiceState =
  | "idle"
  | "listening"
  | "thinking"
  | "working"
  | "approval"
  | "error";

export interface TimelinePlanStep {
  step: string;
  status: "pending" | "in_progress" | "completed";
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
  | { type: "transcript"; entry: RealtimeTranscriptEntry; intentHandled: boolean }
  | { type: "error"; message: string };

export type RealtimeEventListener = (event: RealtimeEvent) => void;
export type TimelineUpdateListener = (timeline: TimelineState) => void;
