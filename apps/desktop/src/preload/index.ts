import { contextBridge, ipcRenderer } from "electron";
import type { AppBridge } from "@shared";

const APP_GET_INFO = "app:get-info";
const SESSION_GET_STATE = "session:get-state";
const WORKSPACE_GET_STATE = "workspace:get-state";
const WORKSPACE_OPEN = "workspace:open";
const TIMELINE_GET_STATE = "timeline:get-state";
const TURN_START = "turn:start";
const APPROVAL_RESPOND = "approval:respond";
const USER_INPUT_SUBMIT = "user-input:submit";

const appBridge: AppBridge = {
  getAppInfo: () => ipcRenderer.invoke(APP_GET_INFO),
  getSessionState: () => ipcRenderer.invoke(SESSION_GET_STATE),
  getWorkspaceState: () => ipcRenderer.invoke(WORKSPACE_GET_STATE),
  openWorkspace: () => ipcRenderer.invoke(WORKSPACE_OPEN),
  getTimelineState: () => ipcRenderer.invoke(TIMELINE_GET_STATE),
  startTurn: (prompt) => ipcRenderer.invoke(TURN_START, prompt),
  respondToApproval: (requestId, decision) =>
    ipcRenderer.invoke(APPROVAL_RESPOND, requestId, decision),
  submitUserInput: (requestId, answers) =>
    ipcRenderer.invoke(USER_INPUT_SUBMIT, requestId, answers)
};

contextBridge.exposeInMainWorld("appBridge", appBridge);
