import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { registerIpcHandlers } from "./ipc";

const createMainWindow = () => {
  const window = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#12100c",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
    window.webContents.openDevTools({ mode: "detach" });
    return window;
  }

  void window.loadFile(join(__dirname, "../renderer/index.html"));
  return window;
};

app.whenReady().then(() => {
  registerIpcHandlers();
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
