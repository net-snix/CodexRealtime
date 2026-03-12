import { contextBridge, ipcRenderer } from "electron";
import type { NativeApi } from "@codex-realtime/contracts";
import { IPC_CHANNELS } from "@codex-realtime/contracts/ipc";

const nativeApi: NativeApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appGetInfo),
  getAppSettingsState: () => ipcRenderer.invoke(IPC_CHANNELS.appSettingsGet),
  updateAppSettings: (patch) => ipcRenderer.invoke(IPC_CHANNELS.appSettingsUpdate, patch),
  showDesktopNotification: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.appNotificationShow, request),
  openUserDataDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.appUserDataOpen),
  getSessionState: () => ipcRenderer.invoke(IPC_CHANNELS.sessionGetState),
  getWorkspaceState: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceGetState),
  openWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceOpen),
  openCurrentWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceOpenCurrent),
  clearRecentWorkspaces: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceClearRecent),
  removeWorkspace: (workspaceId) => ipcRenderer.invoke(IPC_CHANNELS.workspaceRemove, workspaceId),
  selectWorkspace: (workspaceId) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSelect, workspaceId),
  createThread: (workspaceId) => ipcRenderer.invoke(IPC_CHANNELS.threadCreate, workspaceId),
  selectThread: (workspaceId, threadId) =>
    ipcRenderer.invoke(IPC_CHANNELS.threadSelect, workspaceId, threadId),
  archiveThread: (workspaceId, threadId) =>
    ipcRenderer.invoke(IPC_CHANNELS.threadArchive, workspaceId, threadId),
  unarchiveThread: (workspaceId, threadId) =>
    ipcRenderer.invoke(IPC_CHANNELS.threadUnarchive, workspaceId, threadId),
  getTimelineState: () => ipcRenderer.invoke(IPC_CHANNELS.timelineGetState),
  getWorkerSettingsState: () => ipcRenderer.invoke(IPC_CHANNELS.workerSettingsGet),
  updateWorkerSettings: (patch) => ipcRenderer.invoke(IPC_CHANNELS.workerSettingsUpdate, patch),
  pickWorkerAttachments: () => ipcRenderer.invoke(IPC_CHANNELS.workerAttachmentsPick),
  addWorkerAttachments: (paths) => ipcRenderer.invoke(IPC_CHANNELS.workerAttachmentsAdd, paths),
  addPastedImageAttachments: (images) =>
    ipcRenderer.invoke(IPC_CHANNELS.workerAttachmentsAddPastedImages, images),
  startTurn: (request) => ipcRenderer.invoke(IPC_CHANNELS.turnStart, request),
  interruptActiveTurn: () => ipcRenderer.invoke(IPC_CHANNELS.turnInterrupt),
  respondToApproval: (requestId, decision) =>
    ipcRenderer.invoke(IPC_CHANNELS.approvalRespond, requestId, decision),
  submitUserInput: (requestId, answers) =>
    ipcRenderer.invoke(IPC_CHANNELS.userInputSubmit, requestId, answers),
  getRealtimeState: () => ipcRenderer.invoke(IPC_CHANNELS.realtimeGetState),
  startRealtime: (prompt) => ipcRenderer.invoke(IPC_CHANNELS.realtimeStart, prompt),
  stopRealtime: () => ipcRenderer.invoke(IPC_CHANNELS.realtimeStop),
  appendRealtimeAudio: (audio) => ipcRenderer.invoke(IPC_CHANNELS.realtimeAppendAudio, audio),
  appendRealtimeText: (text) => ipcRenderer.invoke(IPC_CHANNELS.realtimeAppendText, text),
  dispatchVoicePrompt: (prompt) =>
    ipcRenderer.invoke(IPC_CHANNELS.realtimeDispatchPrompt, prompt),
  getVoicePreferences: () => ipcRenderer.invoke(IPC_CHANNELS.voicePreferencesGet),
  updateVoicePreferences: (preferences) =>
    ipcRenderer.invoke(IPC_CHANNELS.voicePreferencesUpdate, preferences),
  resetVoicePreferences: () => ipcRenderer.invoke(IPC_CHANNELS.voicePreferencesReset),
  subscribeRealtimeEvents: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) =>
      listener(payload);

    ipcRenderer.on(IPC_CHANNELS.realtimeEvent, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.realtimeEvent, wrapped);
  },
  subscribeTimelineUpdates: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) =>
      listener(payload);

    ipcRenderer.on(IPC_CHANNELS.timelineEvent, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.timelineEvent, wrapped);
  },
};

contextBridge.exposeInMainWorld("appBridge", nativeApi);
contextBridge.exposeInMainWorld("nativeApi", nativeApi);
