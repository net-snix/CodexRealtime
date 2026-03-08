import { contextBridge, ipcRenderer } from "electron";
import type { AppBridge } from "@shared";

const APP_GET_INFO = "app:get-info";

const appBridge: AppBridge = {
  getAppInfo: () => ipcRenderer.invoke(APP_GET_INFO),
};

contextBridge.exposeInMainWorld("appBridge", appBridge);
