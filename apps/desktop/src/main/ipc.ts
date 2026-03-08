import { app, ipcMain } from "electron";
import type { AppInfo } from "@shared";

const APP_GET_INFO = "app:get-info";

const readAppInfo = (): AppInfo => ({
  name: app.getName(),
  version: app.getVersion(),
  platform: process.platform,
});

export const registerIpcHandlers = () => {
  ipcMain.removeHandler(APP_GET_INFO);
  ipcMain.handle(APP_GET_INFO, () => readAppInfo());
};
