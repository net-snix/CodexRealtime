import { app, BrowserWindow, ipcMain } from "electron";
import type { AppInfo } from "@shared";
import { appNotificationService } from "./notification-service";
import { appSettingsService } from "./app-settings-service";
import { codexBridge } from "./codex-bridge";
import { realtimeService } from "./realtime-service";
import { voicePreferencesService } from "./voice-preferences-service";
import { workspaceService } from "./workspace-service";

const APP_GET_INFO = "app:get-info";
const APP_SETTINGS_GET = "app-settings:get";
const APP_SETTINGS_UPDATE = "app-settings:update";
const APP_NOTIFICATION_SHOW = "app-notification:show";
const APP_USER_DATA_OPEN = "app-user-data:open";
const SESSION_GET_STATE = "session:get-state";
const WORKSPACE_GET_STATE = "workspace:get-state";
const WORKSPACE_OPEN = "workspace:open";
const WORKSPACE_OPEN_CURRENT = "workspace:open-current";
const WORKSPACE_CLEAR_RECENT = "workspace:clear-recent";
const WORKSPACE_REMOVE = "workspace:remove";
const WORKSPACE_SELECT = "workspace:select";
const THREAD_CREATE = "thread:create";
const THREAD_SELECT = "thread:select";
const THREAD_ARCHIVE = "thread:archive";
const THREAD_UNARCHIVE = "thread:unarchive";
const TIMELINE_GET_STATE = "timeline:get-state";
const TIMELINE_EVENT = "timeline:event";
const WORKER_SETTINGS_GET = "worker-settings:get";
const WORKER_SETTINGS_UPDATE = "worker-settings:update";
const WORKER_ATTACHMENTS_PICK = "worker-attachments:pick";
const WORKER_ATTACHMENTS_ADD = "worker-attachments:add";
const WORKER_ATTACHMENTS_ADD_PASTED_IMAGES = "worker-attachments:add-pasted-images";
const TURN_START = "turn:start";
const TURN_INTERRUPT = "turn:interrupt";
const APPROVAL_RESPOND = "approval:respond";
const USER_INPUT_SUBMIT = "user-input:submit";
const REALTIME_GET_STATE = "realtime:get-state";
const REALTIME_START = "realtime:start";
const REALTIME_STOP = "realtime:stop";
const REALTIME_APPEND_AUDIO = "realtime:append-audio";
const REALTIME_APPEND_TEXT = "realtime:append-text";
const REALTIME_DISPATCH_PROMPT = "realtime:dispatch-prompt";
const REALTIME_EVENT = "realtime:event";
const VOICE_PREFERENCES_GET = "voice-preferences:get";
const VOICE_PREFERENCES_UPDATE = "voice-preferences:update";
const VOICE_PREFERENCES_RESET = "voice-preferences:reset";

const readAppInfo = (): AppInfo => ({
  name: app.getName(),
  version: app.getVersion(),
  platform: process.platform,
});

export const registerIpcHandlers = () => {
  realtimeService.removeAllListeners("event");
  realtimeService.on("event", (event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(REALTIME_EVENT, event);
    }
  });
  workspaceService.removeAllListeners("timeline");
  workspaceService.on("timeline", (timeline) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(TIMELINE_EVENT, timeline);
    }
  });

  ipcMain.removeHandler(APP_GET_INFO);
  ipcMain.handle(APP_GET_INFO, () => readAppInfo());
  ipcMain.removeHandler(APP_SETTINGS_GET);
  ipcMain.handle(APP_SETTINGS_GET, () => appSettingsService.getSettingsState());
  ipcMain.removeHandler(APP_SETTINGS_UPDATE);
  ipcMain.handle(APP_SETTINGS_UPDATE, (_event, patch) => appSettingsService.updateSettings(patch));
  ipcMain.removeHandler(APP_NOTIFICATION_SHOW);
  ipcMain.handle(APP_NOTIFICATION_SHOW, (_event, request) => appNotificationService.show(request));
  ipcMain.removeHandler(APP_USER_DATA_OPEN);
  ipcMain.handle(APP_USER_DATA_OPEN, async () => {
    const { shell } = await import("electron");
    await shell.openPath(app.getPath("userData"));
  });
  ipcMain.removeHandler(SESSION_GET_STATE);
  ipcMain.handle(SESSION_GET_STATE, () => codexBridge.refreshState());
  ipcMain.removeHandler(WORKSPACE_GET_STATE);
  ipcMain.handle(WORKSPACE_GET_STATE, () => workspaceService.getWorkspaceState());
  ipcMain.removeHandler(WORKSPACE_OPEN);
  ipcMain.handle(WORKSPACE_OPEN, () => workspaceService.openWorkspace());
  ipcMain.removeHandler(WORKSPACE_OPEN_CURRENT);
  ipcMain.handle(WORKSPACE_OPEN_CURRENT, () => workspaceService.openCurrentWorkspace());
  ipcMain.removeHandler(WORKSPACE_CLEAR_RECENT);
  ipcMain.handle(WORKSPACE_CLEAR_RECENT, () => workspaceService.clearRecentWorkspaces());
  ipcMain.removeHandler(WORKSPACE_REMOVE);
  ipcMain.handle(WORKSPACE_REMOVE, (_event, workspaceId: string) =>
    workspaceService.removeWorkspace(workspaceId)
  );
  ipcMain.removeHandler(WORKSPACE_SELECT);
  ipcMain.handle(WORKSPACE_SELECT, (_event, workspaceId: string) =>
    workspaceService.selectWorkspace(workspaceId)
  );
  ipcMain.removeHandler(THREAD_CREATE);
  ipcMain.handle(THREAD_CREATE, (_event, workspaceId: string) =>
    workspaceService.createThread(workspaceId)
  );
  ipcMain.removeHandler(THREAD_SELECT);
  ipcMain.handle(THREAD_SELECT, (_event, workspaceId: string, threadId: string) =>
    workspaceService.selectThread(workspaceId, threadId)
  );
  ipcMain.removeHandler(THREAD_ARCHIVE);
  ipcMain.handle(THREAD_ARCHIVE, (_event, workspaceId: string, threadId: string) =>
    workspaceService.archiveThread(workspaceId, threadId)
  );
  ipcMain.removeHandler(THREAD_UNARCHIVE);
  ipcMain.handle(THREAD_UNARCHIVE, (_event, workspaceId: string, threadId: string) =>
    workspaceService.unarchiveThread(workspaceId, threadId)
  );
  ipcMain.removeHandler(TIMELINE_GET_STATE);
  ipcMain.handle(TIMELINE_GET_STATE, () => workspaceService.getTimelineState());
  ipcMain.removeHandler(WORKER_SETTINGS_GET);
  ipcMain.handle(WORKER_SETTINGS_GET, () => workspaceService.getWorkerSettingsState());
  ipcMain.removeHandler(WORKER_SETTINGS_UPDATE);
  ipcMain.handle(WORKER_SETTINGS_UPDATE, (_event, patch) =>
    workspaceService.updateWorkerSettings(patch)
  );
  ipcMain.removeHandler(WORKER_ATTACHMENTS_PICK);
  ipcMain.handle(WORKER_ATTACHMENTS_PICK, () => workspaceService.pickWorkerAttachments());
  ipcMain.removeHandler(WORKER_ATTACHMENTS_ADD);
  ipcMain.handle(WORKER_ATTACHMENTS_ADD, (_event, paths: string[]) =>
    workspaceService.addWorkerAttachments(paths)
  );
  ipcMain.removeHandler(WORKER_ATTACHMENTS_ADD_PASTED_IMAGES);
  ipcMain.handle(WORKER_ATTACHMENTS_ADD_PASTED_IMAGES, (_event, images) =>
    workspaceService.addPastedImageAttachments(images)
  );
  ipcMain.removeHandler(TURN_START);
  ipcMain.handle(TURN_START, (_event, request) => workspaceService.startTurn(request));
  ipcMain.removeHandler(TURN_INTERRUPT);
  ipcMain.handle(TURN_INTERRUPT, () => workspaceService.interruptActiveTurn());
  ipcMain.removeHandler(APPROVAL_RESPOND);
  ipcMain.handle(APPROVAL_RESPOND, (_event, requestId: string, decision) =>
    workspaceService.respondToApproval(requestId, decision)
  );
  ipcMain.removeHandler(USER_INPUT_SUBMIT);
  ipcMain.handle(USER_INPUT_SUBMIT, (_event, requestId: string, answers) =>
    workspaceService.submitUserInput(requestId, answers)
  );
  ipcMain.removeHandler(REALTIME_GET_STATE);
  ipcMain.handle(REALTIME_GET_STATE, () => realtimeService.getState());
  ipcMain.removeHandler(REALTIME_START);
  ipcMain.handle(REALTIME_START, (_event, prompt?: string) => realtimeService.start(prompt));
  ipcMain.removeHandler(REALTIME_STOP);
  ipcMain.handle(REALTIME_STOP, () => realtimeService.stop());
  ipcMain.removeHandler(REALTIME_APPEND_AUDIO);
  ipcMain.handle(REALTIME_APPEND_AUDIO, (_event, audio) => realtimeService.appendAudio(audio));
  ipcMain.removeHandler(REALTIME_APPEND_TEXT);
  ipcMain.handle(REALTIME_APPEND_TEXT, (_event, text: string) => realtimeService.appendText(text));
  ipcMain.removeHandler(REALTIME_DISPATCH_PROMPT);
  ipcMain.handle(REALTIME_DISPATCH_PROMPT, (_event, prompt: string) =>
    realtimeService.dispatchVoicePrompt(prompt)
  );
  ipcMain.removeHandler(VOICE_PREFERENCES_GET);
  ipcMain.handle(VOICE_PREFERENCES_GET, () => voicePreferencesService.getPreferences());
  ipcMain.removeHandler(VOICE_PREFERENCES_UPDATE);
  ipcMain.handle(VOICE_PREFERENCES_UPDATE, (_event, preferences) =>
    voicePreferencesService.updatePreferences(preferences)
  );
  ipcMain.removeHandler(VOICE_PREFERENCES_RESET);
  ipcMain.handle(VOICE_PREFERENCES_RESET, () => voicePreferencesService.resetPreferences());
};
