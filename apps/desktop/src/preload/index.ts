import { contextBridge, ipcRenderer } from "electron";
import type { AppBridge } from "@shared";

const APP_GET_INFO = "app:get-info";
const SESSION_GET_STATE = "session:get-state";

const appBridge: AppBridge = {
  getAppInfo: () => ipcRenderer.invoke(APP_GET_INFO),
  getSessionState: () => ipcRenderer.invoke(SESSION_GET_STATE)
};

contextBridge.exposeInMainWorld("appBridge", appBridge);
