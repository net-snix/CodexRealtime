import { app, ipcMain } from "electron";
import type { AppInfo } from "@shared";
import { codexBridge } from "./codex-bridge";

const APP_GET_INFO = "app:get-info";
const SESSION_GET_STATE = "session:get-state";

const readAppInfo = (): AppInfo => ({
  name: app.getName(),
  version: app.getVersion(),
  platform: process.platform,
});

export const registerIpcHandlers = () => {
  ipcMain.removeHandler(APP_GET_INFO);
  ipcMain.handle(APP_GET_INFO, () => readAppInfo());
  ipcMain.removeHandler(SESSION_GET_STATE);
  ipcMain.handle(SESSION_GET_STATE, () => codexBridge.refreshState());
};
