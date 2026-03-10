import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import { join } from "node:path";
import { codexBridge } from "./codex-bridge";
import { registerIpcHandlers } from "./ipc";
import { workspaceService } from "./workspace-service";

const installApplicationMenu = () => {
  const template: MenuItemConstructorOptions[] =
    process.platform === "darwin"
      ? [
          { role: "appMenu" },
          { role: "fileMenu" },
          { role: "editMenu" },
          { role: "viewMenu" },
          { role: "windowMenu" }
        ]
      : [{ role: "fileMenu" }, { role: "editMenu" }, { role: "viewMenu" }];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const createMainWindow = () => {
  const window = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#12100c",
    acceptFirstMouse: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
    return window;
  }

  void window.loadFile(join(__dirname, "../renderer/index.html"));
  return window;
};

app.whenReady().then(async () => {
  installApplicationMenu();
  void codexBridge.start().then(() => codexBridge.refreshState());
  registerIpcHandlers();
  await workspaceService.restoreLastWorkspace();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void codexBridge.stop();
});
