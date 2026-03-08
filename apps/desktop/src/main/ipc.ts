import { app, ipcMain } from "electron";
import type { AppInfo } from "@shared";
import { codexBridge } from "./codex-bridge";
import { workspaceService } from "./workspace-service";

const APP_GET_INFO = "app:get-info";
const SESSION_GET_STATE = "session:get-state";
const WORKSPACE_GET_STATE = "workspace:get-state";
const WORKSPACE_OPEN = "workspace:open";
const TIMELINE_GET_STATE = "timeline:get-state";
const TURN_START = "turn:start";

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
  ipcMain.removeHandler(WORKSPACE_GET_STATE);
  ipcMain.handle(WORKSPACE_GET_STATE, () => workspaceService.getWorkspaceState());
  ipcMain.removeHandler(WORKSPACE_OPEN);
  ipcMain.handle(WORKSPACE_OPEN, () => workspaceService.openWorkspace());
  ipcMain.removeHandler(TIMELINE_GET_STATE);
  ipcMain.handle(TIMELINE_GET_STATE, () => workspaceService.getTimelineState());
  ipcMain.removeHandler(TURN_START);
  ipcMain.handle(TURN_START, (_event, prompt: string) => workspaceService.startTurn(prompt));
};
