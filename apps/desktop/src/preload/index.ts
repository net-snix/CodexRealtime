import { contextBridge, ipcRenderer } from "electron";
import type { AppBridge } from "@shared";

const APP_GET_INFO = "app:get-info";
const APP_SETTINGS_GET = "app-settings:get";
const APP_SETTINGS_UPDATE = "app-settings:update";
const APP_NOTIFICATION_SHOW = "app-notification:show";
const APP_USER_DATA_OPEN = "app-user-data:open";
const SESSION_GET_STATE = "session:get-state";
const WORKSPACE_GET_STATE = "workspace:get-state";
const WORKSPACE_OPEN = "workspace:open";
const WORKSPACE_OPEN_CURRENT = "workspace:open-current";
const WORKSPACE_CLEAR_RECENT = "workspace:clear-recent";
const WORKSPACE_REMOVE = "workspace:remove";
const WORKSPACE_SELECT = "workspace:select";
const THREAD_CREATE = "thread:create";
const THREAD_SELECT = "thread:select";
const THREAD_ARCHIVE = "thread:archive";
const THREAD_UNARCHIVE = "thread:unarchive";
const TIMELINE_GET_STATE = "timeline:get-state";
const TIMELINE_EVENT = "timeline:event";
const WORKER_SETTINGS_GET = "worker-settings:get";
const WORKER_SETTINGS_UPDATE = "worker-settings:update";
const WORKER_ATTACHMENTS_PICK = "worker-attachments:pick";
const WORKER_ATTACHMENTS_ADD = "worker-attachments:add";
const WORKER_ATTACHMENTS_ADD_PASTED_IMAGES = "worker-attachments:add-pasted-images";
const TURN_START = "turn:start";
const TURN_INTERRUPT = "turn:interrupt";
const APPROVAL_RESPOND = "approval:respond";
const USER_INPUT_SUBMIT = "user-input:submit";
const REALTIME_GET_STATE = "realtime:get-state";
const REALTIME_START = "realtime:start";
const REALTIME_STOP = "realtime:stop";
const REALTIME_APPEND_AUDIO = "realtime:append-audio";
const REALTIME_APPEND_TEXT = "realtime:append-text";
const REALTIME_DISPATCH_PROMPT = "realtime:dispatch-prompt";
const REALTIME_EVENT = "realtime:event";
const VOICE_PREFERENCES_GET = "voice-preferences:get";
const VOICE_PREFERENCES_UPDATE = "voice-preferences:update";
const VOICE_PREFERENCES_RESET = "voice-preferences:reset";

const appBridge: AppBridge = {
  getAppInfo: () => ipcRenderer.invoke(APP_GET_INFO),
  getAppSettingsState: () => ipcRenderer.invoke(APP_SETTINGS_GET),
  updateAppSettings: (patch) => ipcRenderer.invoke(APP_SETTINGS_UPDATE, patch),
  showDesktopNotification: (request) => ipcRenderer.invoke(APP_NOTIFICATION_SHOW, request),
  openUserDataDirectory: () => ipcRenderer.invoke(APP_USER_DATA_OPEN),
  getSessionState: () => ipcRenderer.invoke(SESSION_GET_STATE),
  getWorkspaceState: () => ipcRenderer.invoke(WORKSPACE_GET_STATE),
  openWorkspace: () => ipcRenderer.invoke(WORKSPACE_OPEN),
  openCurrentWorkspace: () => ipcRenderer.invoke(WORKSPACE_OPEN_CURRENT),
  clearRecentWorkspaces: () => ipcRenderer.invoke(WORKSPACE_CLEAR_RECENT),
  removeWorkspace: (workspaceId) => ipcRenderer.invoke(WORKSPACE_REMOVE, workspaceId),
  selectWorkspace: (workspaceId) => ipcRenderer.invoke(WORKSPACE_SELECT, workspaceId),
  createThread: (workspaceId) => ipcRenderer.invoke(THREAD_CREATE, workspaceId),
  selectThread: (workspaceId, threadId) => ipcRenderer.invoke(THREAD_SELECT, workspaceId, threadId),
  archiveThread: (workspaceId, threadId) =>
    ipcRenderer.invoke(THREAD_ARCHIVE, workspaceId, threadId),
  unarchiveThread: (workspaceId, threadId) =>
    ipcRenderer.invoke(THREAD_UNARCHIVE, workspaceId, threadId),
  getTimelineState: () => ipcRenderer.invoke(TIMELINE_GET_STATE),
  getWorkerSettingsState: () => ipcRenderer.invoke(WORKER_SETTINGS_GET),
  updateWorkerSettings: (patch) => ipcRenderer.invoke(WORKER_SETTINGS_UPDATE, patch),
  pickWorkerAttachments: () => ipcRenderer.invoke(WORKER_ATTACHMENTS_PICK),
  addWorkerAttachments: (paths) => ipcRenderer.invoke(WORKER_ATTACHMENTS_ADD, paths),
  addPastedImageAttachments: (images) =>
    ipcRenderer.invoke(WORKER_ATTACHMENTS_ADD_PASTED_IMAGES, images),
  startTurn: (request) => ipcRenderer.invoke(TURN_START, request),
  interruptActiveTurn: () => ipcRenderer.invoke(TURN_INTERRUPT),
  respondToApproval: (requestId, decision) =>
    ipcRenderer.invoke(APPROVAL_RESPOND, requestId, decision),
  submitUserInput: (requestId, answers) =>
    ipcRenderer.invoke(USER_INPUT_SUBMIT, requestId, answers),
  getRealtimeState: () => ipcRenderer.invoke(REALTIME_GET_STATE),
  startRealtime: (prompt) => ipcRenderer.invoke(REALTIME_START, prompt),
  stopRealtime: () => ipcRenderer.invoke(REALTIME_STOP),
  appendRealtimeAudio: (audio) => ipcRenderer.invoke(REALTIME_APPEND_AUDIO, audio),
  appendRealtimeText: (text) => ipcRenderer.invoke(REALTIME_APPEND_TEXT, text),
  dispatchVoicePrompt: (prompt) => ipcRenderer.invoke(REALTIME_DISPATCH_PROMPT, prompt),
  getVoicePreferences: () => ipcRenderer.invoke(VOICE_PREFERENCES_GET),
  updateVoicePreferences: (preferences) =>
    ipcRenderer.invoke(VOICE_PREFERENCES_UPDATE, preferences),
  resetVoicePreferences: () => ipcRenderer.invoke(VOICE_PREFERENCES_RESET),
  subscribeRealtimeEvents: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) =>
      listener(payload);

    ipcRenderer.on(REALTIME_EVENT, wrapped);
    return () => ipcRenderer.removeListener(REALTIME_EVENT, wrapped);
  },
  subscribeTimelineUpdates: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) =>
      listener(payload);

    ipcRenderer.on(TIMELINE_EVENT, wrapped);
    return () => ipcRenderer.removeListener(TIMELINE_EVENT, wrapped);
  }
};

contextBridge.exposeInMainWorld("appBridge", appBridge);
