import { contextBridge, ipcRenderer } from "electron";
import type { AppBridge } from "@shared";

const APP_GET_INFO = "app:get-info";
const SESSION_GET_STATE = "session:get-state";
const WORKSPACE_GET_STATE = "workspace:get-state";
const WORKSPACE_OPEN = "workspace:open";
const WORKSPACE_OPEN_CURRENT = "workspace:open-current";
const WORKSPACE_SELECT = "workspace:select";
const THREAD_SELECT = "thread:select";
const TIMELINE_GET_STATE = "timeline:get-state";
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

const appBridge: AppBridge = {
  getAppInfo: () => ipcRenderer.invoke(APP_GET_INFO),
  getSessionState: () => ipcRenderer.invoke(SESSION_GET_STATE),
  getWorkspaceState: () => ipcRenderer.invoke(WORKSPACE_GET_STATE),
  openWorkspace: () => ipcRenderer.invoke(WORKSPACE_OPEN),
  openCurrentWorkspace: () => ipcRenderer.invoke(WORKSPACE_OPEN_CURRENT),
  selectWorkspace: (workspaceId) => ipcRenderer.invoke(WORKSPACE_SELECT, workspaceId),
  selectThread: (workspaceId, threadId) => ipcRenderer.invoke(THREAD_SELECT, workspaceId, threadId),
  getTimelineState: () => ipcRenderer.invoke(TIMELINE_GET_STATE),
  startTurn: (prompt) => ipcRenderer.invoke(TURN_START, prompt),
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
  subscribeRealtimeEvents: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) =>
      listener(payload);

    ipcRenderer.on(REALTIME_EVENT, wrapped);
    return () => ipcRenderer.removeListener(REALTIME_EVENT, wrapped);
  }
};

contextBridge.exposeInMainWorld("appBridge", appBridge);
