import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from "electron";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createBootstrapLogger } from "./bootstrap-logger";
import { codexBridge } from "./codex-bridge";
import { registerIpcHandlers } from "./ipc";
import { LocalServerProcess } from "./local-server-process";
import { realtimeService } from "./realtime-service";
import { workspaceService } from "./workspace-service";

const userDataOverride = process.env.CODEX_REALTIME_USER_DATA_DIR;
const HELPER_CLEANUP_INTERVAL_MS = 45_000;
const HELPER_CLEANUP_MIN_AGE_SECONDS = 45;

if (userDataOverride) {
  app.setPath("userData", userDataOverride);
}

let helperCleanupInterval: NodeJS.Timeout | null = null;
let isQuitting = false;
const bootstrapId = randomUUID();
const { bootstrapLogger, localServerLogger, shutdownLogger, paths: bootstrapLogPaths } =
  createBootstrapLogger({
    bootstrapId,
    appVersion: app.getVersion(),
    userDataPath: app.getPath("userData")
  });

const localServerProcess = new LocalServerProcess({
  bootstrapId,
  serverLogFilePath: bootstrapLogPaths.serverLogPath,
  expectedVersion: app.getVersion(),
  onUnexpectedExit: ({ code, signal, expectedVersion, handshake }) => {
    bootstrapLogger.error("Local server crashed after startup", {
      code,
      signal,
      expectedVersion,
      actualVersion: handshake?.version ?? null,
      baseUrl: handshake?.baseUrl ?? null
    });

    if (!isQuitting) {
      app.exit(1);
    }
  }
}, localServerLogger);

const installApplicationMenu = () => {
  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      {
        label: "Open Repository...",
        accelerator: "CmdOrCtrl+O",
        click: () => {
          void workspaceService.openWorkspace();
        }
      },
      {
        label: "Use Current Repo",
        accelerator: "CmdOrCtrl+Shift+O",
        click: () => {
          void workspaceService.openCurrentWorkspace();
        }
      },
      { type: "separator" },
      process.platform === "darwin" ? { role: "close" } : { role: "quit" }
    ]
  };

  const template: MenuItemConstructorOptions[] =
    process.platform === "darwin"
      ? [{ role: "appMenu" }, fileMenu, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" }]
      : [fileMenu, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" }];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const getSafeExternalUrl = (rawUrl: string): string | null => {
  try {
    const parsedUrl = new URL(rawUrl);
    if (parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:") {
      return parsedUrl.toString();
    }
  } catch {
    return null;
  }

  return null;
};

const isAppNavigation = (targetUrl: string, rendererUrl?: string): boolean => {
  try {
    const parsedTarget = new URL(targetUrl);

    if (rendererUrl) {
      return parsedTarget.origin === new URL(rendererUrl).origin;
    }

    return parsedTarget.protocol === "file:";
  } catch {
    return false;
  }
};

const buildContextMenuTemplate = (
  window: BrowserWindow,
  params: Electron.ContextMenuParams
): MenuItemConstructorOptions[] => {
  const template: MenuItemConstructorOptions[] = [];

  if (params.misspelledWord) {
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      template.push({
        label: suggestion,
        click: () => window.webContents.replaceMisspelling(suggestion)
      });
    }

    if (params.dictionarySuggestions.length === 0) {
      template.push({ label: "No suggestions", enabled: false });
    }

    template.push({ type: "separator" });
  }

  if (params.linkURL) {
    template.push({
      label: "Open Link in Browser",
      click: () => {
        const externalUrl = getSafeExternalUrl(params.linkURL);
        if (externalUrl) {
          void shell.openExternal(externalUrl);
        }
      }
    });
    template.push({ type: "separator" });
  }

  template.push(
    { role: "cut", enabled: params.editFlags.canCut },
    { role: "copy", enabled: params.editFlags.canCopy || params.selectionText.length > 0 },
    { role: "paste", enabled: params.editFlags.canPaste },
    { role: "selectAll", enabled: params.editFlags.canSelectAll }
  );

  return template;
};

const createMainWindow = () => {
  const isMac = process.platform === "darwin";
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  const window = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    autoHideMenuBar: !isMac,
    title: app.getName(),
    backgroundColor: "#faf7f2",
    acceptFirstMouse: true,
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 10, y: 10 }
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  window.webContents.on("context-menu", (event, params) => {
    event.preventDefault();
    Menu.buildFromTemplate(buildContextMenuTemplate(window, params)).popup({ window });
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = getSafeExternalUrl(url);
    if (externalUrl) {
      void shell.openExternal(externalUrl);
    }

    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (isAppNavigation(targetUrl, rendererUrl)) {
      return;
    }

    const externalUrl = getSafeExternalUrl(targetUrl);
    if (externalUrl) {
      event.preventDefault();
      void shell.openExternal(externalUrl);
      return;
    }

    event.preventDefault();
  });

  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(app.getName());
  });

  window.webContents.on("did-finish-load", () => {
    window.setTitle(app.getName());
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
    return window;
  }

  void window.loadFile(join(__dirname, "../renderer/index.html"));
  return window;
};

const stopBridgeWork = async () => {
  shutdownLogger.info("Desktop shutdown starting");

  try {
    await realtimeService.stop();
  } catch {
    // Ignore shutdown races from idle sessions.
  }

  try {
    await localServerProcess.stop();
    await codexBridge.stop();
    shutdownLogger.info("Desktop shutdown completed");
  } catch (error) {
    shutdownLogger.error("Desktop shutdown failed", { error });
    throw error;
  }
};

const maybeCleanupIdleHelpers = async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    return;
  }

  if (workspaceService.hasActiveTurn() || codexBridge.hasPendingRequests()) {
    return;
  }

  const realtimeStatus = realtimeService.getState().status;

  if (realtimeStatus === "connecting" || realtimeStatus === "live") {
    return;
  }

  await codexBridge.cleanupStaleHelpers({
    minimumAgeSeconds: HELPER_CLEANUP_MIN_AGE_SECONDS
  });
};

app.whenReady()
  .then(async () => {
    installApplicationMenu();
    bootstrapLogger.info("Desktop bootstrap starting", {
      userDataPath: app.getPath("userData")
    });
    await localServerProcess.start();
    registerIpcHandlers();
    await workspaceService.restoreLastWorkspace();
    createMainWindow();
    bootstrapLogger.info("Desktop bootstrap completed");
    helperCleanupInterval = setInterval(() => {
      void maybeCleanupIdleHelpers();
    }, HELPER_CLEANUP_INTERVAL_MS);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  })
  .catch((error) => {
    bootstrapLogger.error("Failed to bootstrap desktop services", { error });
    app.exit(1);
  });

app.on("window-all-closed", () => {
  void stopBridgeWork();

  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (isQuitting) {
    return;
  }

  isQuitting = true;
  shutdownLogger.info("Desktop quit requested");
  event.preventDefault();

  if (helperCleanupInterval) {
    clearInterval(helperCleanupInterval);
    helperCleanupInterval = null;
  }

  void stopBridgeWork().finally(() => {
    app.quit();
  });
});
