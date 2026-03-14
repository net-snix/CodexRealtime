import type {
  AppInfo,
  AppSettings,
  AppSettingsState,
  DesktopNotificationRequest,
  EditorId,
  VoiceApiKeyState,
  VoicePreferences,
  WorkerAttachment,
  WorkspaceState,
} from "./index.js";

export interface ShellApi {
  getAppInfo: () => Promise<AppInfo>;
  getAppSettingsState: () => Promise<AppSettingsState>;
  updateAppSettings: (patch: Partial<AppSettings>) => Promise<AppSettingsState>;
  showDesktopNotification: (request: DesktopNotificationRequest) => Promise<boolean>;
  openUserDataDirectory: () => Promise<void>;
  openInEditor: (targetPath: string, editor: EditorId) => Promise<void>;
  openWorkspace: () => Promise<WorkspaceState>;
  openCurrentWorkspace: () => Promise<WorkspaceState>;
  pickWorkerAttachments: () => Promise<WorkerAttachment[]>;
  getVoicePreferences: () => Promise<VoicePreferences>;
  updateVoicePreferences: (preferences: Partial<VoicePreferences>) => Promise<VoicePreferences>;
  resetVoicePreferences: () => Promise<VoicePreferences>;
  getVoiceApiKeyState: () => Promise<VoiceApiKeyState>;
  setVoiceApiKey: (apiKey: string) => Promise<VoiceApiKeyState>;
  clearVoiceApiKey: () => Promise<VoiceApiKeyState>;
  testVoiceApiKey: () => Promise<VoiceApiKeyState>;
}
