import type {
  ApprovalDecision,
  ArchiveThreadResult,
  PastedImageAttachment,
  RealtimeAudioChunk,
  RealtimeEventListener,
  RealtimeState,
  SessionState,
  TimelineState,
  TimelineUpdateListener,
  TurnStartRequest,
  VoiceIntent,
  WorkerAttachment,
  WorkerExecutionSettings,
  WorkerSettingsState,
  WorkspaceState,
} from "./index.js";

export interface ServerApi {
  getSessionState: () => Promise<SessionState>;
  getWorkspaceState: () => Promise<WorkspaceState>;
  clearRecentWorkspaces: () => Promise<WorkspaceState>;
  removeWorkspace: (workspaceId: string) => Promise<WorkspaceState>;
  selectWorkspace: (workspaceId: string) => Promise<WorkspaceState>;
  createThread: (workspaceId: string) => Promise<TimelineState>;
  selectThread: (workspaceId: string, threadId: string) => Promise<TimelineState>;
  archiveThread: (workspaceId: string, threadId: string) => Promise<ArchiveThreadResult>;
  unarchiveThread: (workspaceId: string, threadId: string) => Promise<TimelineState>;
  getTimelineState: () => Promise<TimelineState>;
  getWorkerSettingsState: () => Promise<WorkerSettingsState>;
  updateWorkerSettings: (
    patch: Partial<WorkerExecutionSettings>
  ) => Promise<WorkerSettingsState>;
  addWorkerAttachments: (paths: string[]) => Promise<WorkerAttachment[]>;
  addPastedImageAttachments: (images: PastedImageAttachment[]) => Promise<WorkerAttachment[]>;
  startTurn: (request: TurnStartRequest) => Promise<TimelineState>;
  dispatchVoicePrompt: (prompt: string) => Promise<TimelineState>;
  dispatchVoiceIntent?: (intent: VoiceIntent) => Promise<TimelineState>;
  interruptActiveTurn: () => Promise<TimelineState>;
  respondToApproval: (requestId: string, decision: ApprovalDecision) => Promise<TimelineState>;
  submitUserInput: (
    requestId: string,
    answers: Record<string, string | string[]>
  ) => Promise<TimelineState>;
  getRealtimeState: () => Promise<RealtimeState>;
  startRealtime: (prompt?: string) => Promise<RealtimeState>;
  stopRealtime: () => Promise<RealtimeState>;
  appendRealtimeAudio: (audio: RealtimeAudioChunk) => Promise<void>;
  appendRealtimeText: (text: string) => Promise<void>;
  subscribeRealtimeEvents: (listener: RealtimeEventListener) => () => void;
  subscribeTimelineUpdates: (listener: TimelineUpdateListener) => () => void;
}
