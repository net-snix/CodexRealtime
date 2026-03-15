import { app, BrowserWindow, ipcMain } from "electron";
import type { AppInfo, AppSettings, EditorId } from "@codex-realtime/contracts";
import { IPC_CHANNELS } from "@codex-realtime/contracts/ipc";
import { appNotificationService } from "./notification-service";
import { appSettingsService } from "./app-settings-service";
import { codexBridge } from "./codex-bridge";
import { openInEditor, resolveAvailableEditors } from "./editor-launch";
import { applyWindowScaleToWindows } from "./window-scale";
import { realtimeService } from "./realtime-service";
import { voiceApiKeyService } from "./voice-api-key-service";
import { voicePreferencesService } from "./voice-preferences-service";
import { workspaceService } from "./workspace-service";

const readAppInfo = (): AppInfo => ({
  name: app.getName(),
  version: app.getVersion(),
  platform: process.platform,
  availableEditors: resolveAvailableEditors()
});

export const registerIpcHandlers = () => {
  const applyWindowScale = (settings: AppSettings) => {
    applyWindowScaleToWindows(settings.windowScale);
  };

  realtimeService.removeAllListeners("event");
  realtimeService.on("event", (event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.realtimeEvent, event);
    }
  });
  workspaceService.removeAllListeners("timeline");
  workspaceService.on("timeline", (timeline) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.timelineEvent, timeline);
    }
  });

  ipcMain.removeHandler(IPC_CHANNELS.appGetInfo);
  ipcMain.handle(IPC_CHANNELS.appGetInfo, () => readAppInfo());
  ipcMain.removeHandler(IPC_CHANNELS.appSettingsGet);
  ipcMain.handle(IPC_CHANNELS.appSettingsGet, () => appSettingsService.getSettingsState());
  ipcMain.removeHandler(IPC_CHANNELS.appSettingsUpdate);
  ipcMain.handle(IPC_CHANNELS.appSettingsUpdate, (_event, patch) => {
    const nextState = appSettingsService.updateSettings(patch);
    applyWindowScale(nextState.settings);
    return nextState;
  });
  ipcMain.removeHandler(IPC_CHANNELS.appNotificationShow);
  ipcMain.handle(IPC_CHANNELS.appNotificationShow, (_event, request) =>
    appNotificationService.show(request)
  );
  ipcMain.removeHandler(IPC_CHANNELS.appUserDataOpen);
  ipcMain.handle(IPC_CHANNELS.appUserDataOpen, async () => {
    const { shell } = await import("electron");
    await shell.openPath(app.getPath("userData"));
  });
  ipcMain.removeHandler(IPC_CHANNELS.editorOpen);
  ipcMain.handle(IPC_CHANNELS.editorOpen, (_event, targetPath: string, editor: EditorId) =>
    openInEditor(targetPath, editor)
  );
  ipcMain.removeHandler(IPC_CHANNELS.sessionGetState);
  ipcMain.handle(IPC_CHANNELS.sessionGetState, () => codexBridge.refreshState());
  ipcMain.removeHandler(IPC_CHANNELS.workspaceGetState);
  ipcMain.handle(IPC_CHANNELS.workspaceGetState, () => workspaceService.getWorkspaceState());
  ipcMain.removeHandler(IPC_CHANNELS.workspaceOpen);
  ipcMain.handle(IPC_CHANNELS.workspaceOpen, () => workspaceService.openWorkspace());
  ipcMain.removeHandler(IPC_CHANNELS.workspaceOpenCurrent);
  ipcMain.handle(IPC_CHANNELS.workspaceOpenCurrent, () => workspaceService.openCurrentWorkspace());
  ipcMain.removeHandler(IPC_CHANNELS.workspaceClearRecent);
  ipcMain.handle(IPC_CHANNELS.workspaceClearRecent, () => workspaceService.clearRecentWorkspaces());
  ipcMain.removeHandler(IPC_CHANNELS.workspaceRemove);
  ipcMain.handle(IPC_CHANNELS.workspaceRemove, (_event, workspaceId: string) =>
    workspaceService.removeWorkspace(workspaceId)
  );
  ipcMain.removeHandler(IPC_CHANNELS.workspaceSelect);
  ipcMain.handle(IPC_CHANNELS.workspaceSelect, (_event, workspaceId: string) =>
    workspaceService.selectWorkspace(workspaceId)
  );
  ipcMain.removeHandler(IPC_CHANNELS.threadCreate);
  ipcMain.handle(IPC_CHANNELS.threadCreate, (_event, workspaceId: string) =>
    workspaceService.createThread(workspaceId)
  );
  ipcMain.removeHandler(IPC_CHANNELS.threadSelect);
  ipcMain.handle(IPC_CHANNELS.threadSelect, (_event, workspaceId: string, threadId: string) =>
    workspaceService.selectThread(workspaceId, threadId)
  );
  ipcMain.removeHandler(IPC_CHANNELS.threadArchive);
  ipcMain.handle(IPC_CHANNELS.threadArchive, (_event, workspaceId: string, threadId: string) =>
    workspaceService.archiveThread(workspaceId, threadId)
  );
  ipcMain.removeHandler(IPC_CHANNELS.threadUnarchive);
  ipcMain.handle(
    IPC_CHANNELS.threadUnarchive,
    (_event, workspaceId: string, threadId: string) =>
    workspaceService.unarchiveThread(workspaceId, threadId)
  );
  ipcMain.removeHandler(IPC_CHANNELS.timelineGetState);
  ipcMain.handle(IPC_CHANNELS.timelineGetState, () => workspaceService.getTimelineState());
  ipcMain.removeHandler(IPC_CHANNELS.workerSettingsGet);
  ipcMain.handle(IPC_CHANNELS.workerSettingsGet, () => workspaceService.getWorkerSettingsState());
  ipcMain.removeHandler(IPC_CHANNELS.workerSettingsUpdate);
  ipcMain.handle(IPC_CHANNELS.workerSettingsUpdate, (_event, patch) =>
    workspaceService.updateWorkerSettings(patch)
  );
  ipcMain.removeHandler(IPC_CHANNELS.workerAttachmentsPick);
  ipcMain.handle(IPC_CHANNELS.workerAttachmentsPick, () =>
    workspaceService.pickWorkerAttachments()
  );
  ipcMain.removeHandler(IPC_CHANNELS.workerAttachmentsAdd);
  ipcMain.handle(IPC_CHANNELS.workerAttachmentsAdd, (_event, paths: string[]) =>
    workspaceService.addWorkerAttachments(paths)
  );
  ipcMain.removeHandler(IPC_CHANNELS.workerAttachmentsAddPastedImages);
  ipcMain.handle(IPC_CHANNELS.workerAttachmentsAddPastedImages, (_event, images) =>
    workspaceService.addPastedImageAttachments(images)
  );
  ipcMain.removeHandler(IPC_CHANNELS.turnStart);
  ipcMain.handle(IPC_CHANNELS.turnStart, (_event, request) => workspaceService.startTurn(request));
  ipcMain.removeHandler(IPC_CHANNELS.turnInterrupt);
  ipcMain.handle(IPC_CHANNELS.turnInterrupt, () => workspaceService.interruptActiveTurn());
  ipcMain.removeHandler(IPC_CHANNELS.approvalRespond);
  ipcMain.handle(IPC_CHANNELS.approvalRespond, (_event, requestId: string, decision) =>
    workspaceService.respondToApproval(requestId, decision)
  );
  ipcMain.removeHandler(IPC_CHANNELS.userInputSubmit);
  ipcMain.handle(IPC_CHANNELS.userInputSubmit, (_event, requestId: string, answers) =>
    workspaceService.submitUserInput(requestId, answers)
  );
  ipcMain.removeHandler(IPC_CHANNELS.realtimeGetState);
  ipcMain.handle(IPC_CHANNELS.realtimeGetState, () => realtimeService.getState());
  ipcMain.removeHandler(IPC_CHANNELS.realtimeStart);
  ipcMain.handle(IPC_CHANNELS.realtimeStart, (_event, prompt?: string) =>
    realtimeService.start(prompt)
  );
  ipcMain.removeHandler(IPC_CHANNELS.realtimeStop);
  ipcMain.handle(IPC_CHANNELS.realtimeStop, () => realtimeService.stop());
  ipcMain.removeHandler(IPC_CHANNELS.realtimeAppendAudio);
  ipcMain.handle(IPC_CHANNELS.realtimeAppendAudio, (_event, audio) =>
    realtimeService.appendAudio(audio)
  );
  ipcMain.removeHandler(IPC_CHANNELS.realtimeAppendText);
  ipcMain.handle(IPC_CHANNELS.realtimeAppendText, (_event, text: string) =>
    realtimeService.appendText(text)
  );
  ipcMain.removeHandler(IPC_CHANNELS.realtimeDispatchIntent);
  ipcMain.handle(IPC_CHANNELS.realtimeDispatchIntent, (_event, intent) =>
    realtimeService.dispatchVoiceIntent(intent)
  );
  ipcMain.removeHandler(IPC_CHANNELS.voicePreferencesGet);
  ipcMain.handle(IPC_CHANNELS.voicePreferencesGet, () => voicePreferencesService.getPreferences());
  ipcMain.removeHandler(IPC_CHANNELS.voicePreferencesUpdate);
  ipcMain.handle(IPC_CHANNELS.voicePreferencesUpdate, (_event, preferences) =>
    voicePreferencesService.updatePreferences(preferences)
  );
  ipcMain.removeHandler(IPC_CHANNELS.voicePreferencesReset);
  ipcMain.handle(IPC_CHANNELS.voicePreferencesReset, () =>
    voicePreferencesService.resetPreferences()
  );
  ipcMain.removeHandler(IPC_CHANNELS.voiceApiKeyGetState);
  ipcMain.handle(IPC_CHANNELS.voiceApiKeyGetState, () => voiceApiKeyService.getState());
  ipcMain.removeHandler(IPC_CHANNELS.voiceApiKeySet);
  ipcMain.handle(IPC_CHANNELS.voiceApiKeySet, (_event, apiKey: string) =>
    voiceApiKeyService.setApiKey(apiKey)
  );
  ipcMain.removeHandler(IPC_CHANNELS.voiceApiKeyClear);
  ipcMain.handle(IPC_CHANNELS.voiceApiKeyClear, () => voiceApiKeyService.clearApiKey());
  ipcMain.removeHandler(IPC_CHANNELS.voiceApiKeyTest);
  ipcMain.handle(IPC_CHANNELS.voiceApiKeyTest, () => voiceApiKeyService.testApiKey());
};
