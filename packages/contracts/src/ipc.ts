export const SHELL_API_CHANNELS = {
  appGetInfo: "app:get-info",
  appSettingsGet: "app-settings:get",
  appSettingsUpdate: "app-settings:update",
  appNotificationShow: "app-notification:show",
  appUserDataOpen: "app-user-data:open",
  editorOpen: "editor:open",
  workspaceOpen: "workspace:open",
  workspaceOpenCurrent: "workspace:open-current",
  workerAttachmentsPick: "worker-attachments:pick",
  voicePreferencesGet: "voice-preferences:get",
  voicePreferencesUpdate: "voice-preferences:update",
  voicePreferencesReset: "voice-preferences:reset",
  voiceApiKeyGetState: "voice-api-key:get-state",
  voiceApiKeySet: "voice-api-key:set",
  voiceApiKeyClear: "voice-api-key:clear",
  voiceApiKeyTest: "voice-api-key:test",
} as const;

export const SERVER_API_CHANNELS = {
  sessionGetState: "session:get-state",
  workspaceGetState: "workspace:get-state",
  workspaceClearRecent: "workspace:clear-recent",
  workspaceRemove: "workspace:remove",
  workspaceSelect: "workspace:select",
  threadCreate: "thread:create",
  threadSelect: "thread:select",
  threadArchive: "thread:archive",
  threadUnarchive: "thread:unarchive",
  timelineGetState: "timeline:get-state",
  workerSettingsGet: "worker-settings:get",
  workerSettingsUpdate: "worker-settings:update",
  workerAttachmentsAdd: "worker-attachments:add",
  workerAttachmentsAddPastedImages: "worker-attachments:add-pasted-images",
  turnStart: "turn:start",
  turnInterrupt: "turn:interrupt",
  approvalRespond: "approval:respond",
  userInputSubmit: "user-input:submit",
  realtimeGetState: "realtime:get-state",
  realtimeStart: "realtime:start",
  realtimeStop: "realtime:stop",
  realtimeAppendAudio: "realtime:append-audio",
  realtimeAppendText: "realtime:append-text",
  realtimeDispatchIntent: "realtime:dispatch-intent",
} as const;

export const IPC_EVENT_CHANNELS = {
  timelineEvent: "timeline:event",
  realtimeEvent: "realtime:event",
} as const;

export const IPC_CHANNELS = {
  ...SHELL_API_CHANNELS,
  ...SERVER_API_CHANNELS,
  ...IPC_EVENT_CHANNELS,
} as const;

export type ShellApiChannel = (typeof SHELL_API_CHANNELS)[keyof typeof SHELL_API_CHANNELS];
export type ServerApiChannel = (typeof SERVER_API_CHANNELS)[keyof typeof SERVER_API_CHANNELS];
export type IpcEventChannel = (typeof IPC_EVENT_CHANNELS)[keyof typeof IPC_EVENT_CHANNELS];
export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
