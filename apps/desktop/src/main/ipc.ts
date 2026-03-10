import { app, BrowserWindow, ipcMain } from "electron";
import type { AppInfo } from "@shared";
import { codexBridge } from "./codex-bridge";
import { realtimeService } from "./realtime-service";
import { voicePreferencesService } from "./voice-preferences-service";
import { workspaceService } from "./workspace-service";

const APP_GET_INFO = "app:get-info";
const SESSION_GET_STATE = "session:get-state";
const WORKSPACE_GET_STATE = "workspace:get-state";
const WORKSPACE_OPEN = "workspace:open";
const WORKSPACE_OPEN_CURRENT = "workspace:open-current";
const WORKSPACE_SELECT = "workspace:select";
const THREAD_SELECT = "thread:select";
const TIMELINE_GET_STATE = "timeline:get-state";
const WORKER_SETTINGS_GET = "worker-settings:get";
const WORKER_SETTINGS_UPDATE = "worker-settings:update";
const WORKER_ATTACHMENTS_PICK = "worker-attachments:pick";
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

  ipcMain.removeHandler(APP_GET_INFO);
  ipcMain.handle(APP_GET_INFO, () => readAppInfo());
  ipcMain.removeHandler(SESSION_GET_STATE);
  ipcMain.handle(SESSION_GET_STATE, () => codexBridge.refreshState());
  ipcMain.removeHandler(WORKSPACE_GET_STATE);
  ipcMain.handle(WORKSPACE_GET_STATE, () => workspaceService.getWorkspaceState());
  ipcMain.removeHandler(WORKSPACE_OPEN);
  ipcMain.handle(WORKSPACE_OPEN, () => workspaceService.openWorkspace());
  ipcMain.removeHandler(WORKSPACE_OPEN_CURRENT);
  ipcMain.handle(WORKSPACE_OPEN_CURRENT, () => workspaceService.openCurrentWorkspace());
  ipcMain.removeHandler(WORKSPACE_SELECT);
  ipcMain.handle(WORKSPACE_SELECT, (_event, workspaceId: string) =>
    workspaceService.selectWorkspace(workspaceId)
  );
  ipcMain.removeHandler(THREAD_SELECT);
  ipcMain.handle(THREAD_SELECT, (_event, workspaceId: string, threadId: string) =>
    workspaceService.selectThread(workspaceId, threadId)
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
};
