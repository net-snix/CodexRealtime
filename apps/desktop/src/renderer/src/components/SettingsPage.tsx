import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  AppInfo,
  AppSettings,
  AppSettingsState,
  AudioDeviceOption,
  SessionState,
  TimelineState,
  VoiceApiKeyState,
  VoiceMode,
  WorkerApprovalPolicy,
  WorkerReasoningEffort,
  WorkerSettingsState,
  WorkspaceState
} from "@shared";

type SettingsSectionKey =
  | "general"
  | "voice"
  | "workers"
  | "notifications"
  | "threads"
  | "privacy"
  | "diagnostics";

type SettingsPageProps = {
  appInfo: AppInfo | null;
  appSettingsState: AppSettingsState;
  isUpdatingAppSettings: boolean;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => void | Promise<void>;
  sessionState: SessionState | null;
  workspaceState: WorkspaceState;
  timelineState: TimelineState;
  workerSettingsState: WorkerSettingsState;
  isUpdatingWorkerSettings: boolean;
  onUpdateWorkerSettings: (
    patch: Partial<{
      model: string | null;
      reasoningEffort: WorkerReasoningEffort;
      fastMode: boolean;
      approvalPolicy: WorkerApprovalPolicy;
    }>
  ) => void | Promise<void>;
  voiceMode: VoiceMode;
  speakAgentActivity: boolean;
  speakToolCalls: boolean;
  speakPlanUpdates: boolean;
  onUpdateVoicePreferences: (
    patch: Partial<{
      mode: VoiceMode;
      speakAgentActivity: boolean;
      speakToolCalls: boolean;
      speakPlanUpdates: boolean;
    }>
  ) => void | Promise<void>;
  voiceApiKeyState: VoiceApiKeyState;
  isSavingVoiceApiKey: boolean;
  isTestingVoiceApiKey: boolean;
  onSaveVoiceApiKey: (apiKey: string) => void | Promise<VoiceApiKeyState>;
  onClearVoiceApiKey: () => void | Promise<VoiceApiKeyState>;
  onTestVoiceApiKey: () => void | Promise<VoiceApiKeyState>;
  inputDevices: AudioDeviceOption[];
  outputDevices: AudioDeviceOption[];
  selectedInputDeviceId: string;
  selectedOutputDeviceId: string;
  supportsOutputSelection: boolean;
  onInputDeviceChange: (deviceId: string) => void;
  onOutputDeviceChange: (deviceId: string) => void;
  shouldShowDeviceHint: boolean;
  onDismissDeviceHint: () => void;
  onResetVoicePreferences: () => void | Promise<void>;
  archivingThreadId: string | null;
  restoringThreadId: string | null;
  archiveError: string | null;
  onArchiveThread: (workspaceId: string, threadId: string) => void | Promise<void>;
  onUnarchiveThread: (workspaceId: string, threadId: string) => void | Promise<void>;
  onOpenUserDataDirectory: () => void | Promise<void>;
  onClearRecentWorkspaces: () => void | Promise<void>;
  onClose: () => void;
};

const REASONING_LABELS: Record<WorkerReasoningEffort, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high"
};

const APPROVAL_LABELS: Record<WorkerApprovalPolicy, string> = {
  untrusted: "Untrusted",
  "on-failure": "On failure",
  "on-request": "On request",
  never: "Never"
};

const SETTINGS_SECTIONS: Array<{ key: SettingsSectionKey; label: string }> = [
  { key: "general", label: "General" },
  { key: "voice", label: "Voice" },
  { key: "workers", label: "Workers" },
  { key: "notifications", label: "Notifications" },
  { key: "threads", label: "Threads" },
  { key: "privacy", label: "Privacy" },
  { key: "diagnostics", label: "Diagnostics" }
];

function SectionCard({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <article className="settings-card">
      <div className="settings-card-head">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      <div className="settings-card-body">{children}</div>
    </article>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  note,
  onChange
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  note?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="settings-row settings-row-toggle">
      <div className="settings-row-copy">
        <strong>{label}</strong>
        <span>{description}</span>
        {note ? <small>{note}</small> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`settings-switch ${checked ? "settings-switch-on" : ""}`}
        onClick={() => onChange(!checked)}
        disabled={disabled}
      >
        <span className="settings-switch-thumb" aria-hidden="true" />
      </button>
    </div>
  );
}

function SelectRow({
  label,
  description,
  value,
  disabled,
  children,
  onChange
}: {
  label: string;
  description: string;
  value: string;
  disabled?: boolean;
  children: React.ReactNode;
  onChange: (value: string) => void;
}) {
  return (
    <label className="settings-row settings-row-select">
      <div className="settings-row-copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <span className="settings-select-wrap">
        <select
          className="settings-select"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        >
          {children}
        </select>
      </span>
    </label>
  );
}

function ThemeSegmentRow({
  label,
  description,
  value,
  disabled,
  onChange
}: {
  label: string;
  description: string;
  value: AppSettings["theme"];
  disabled?: boolean;
  onChange: (value: AppSettings["theme"]) => void;
}) {
  return (
    <div className="settings-row settings-row-segment">
      <div className="settings-row-copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <div className="settings-segmented" role="radiogroup" aria-label={`${label} options`}>
        <button
          type="button"
          role="radio"
          aria-checked={value === "system"}
          className={`settings-segment ${value === "system" ? "settings-segment-selected" : ""}`}
          onClick={() => onChange("system")}
          disabled={disabled}
        >
          System
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={value === "light"}
          className={`settings-segment ${value === "light" ? "settings-segment-selected" : ""}`}
          onClick={() => onChange("light")}
          disabled={disabled}
        >
          Light
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={value === "dark"}
          className={`settings-segment ${value === "dark" ? "settings-segment-selected" : ""}`}
          onClick={() => onChange("dark")}
          disabled={disabled}
        >
          Dark
        </button>
      </div>
    </div>
  );
}

function ActionRow({
  label,
  description,
  actionLabel,
  disabled,
  tone = "default",
  onAction
}: {
  label: string;
  description: string;
  actionLabel: string;
  disabled?: boolean;
  tone?: "default" | "danger";
  onAction: () => void | Promise<unknown>;
}) {
  return (
    <div className="settings-row settings-row-action">
      <div className="settings-row-copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <button
        type="button"
        className={tone === "danger" ? "settings-button settings-button-danger" : "settings-button"}
        onClick={() => void onAction()}
        disabled={disabled}
      >
        {actionLabel}
      </button>
    </div>
  );
}

function InputActionRow({
  label,
  description,
  value,
  placeholder,
  disabled,
  actionLabel,
  secondaryActionLabel,
  note,
  onChange,
  onAction,
  onSecondaryAction
}: {
  label: string;
  description: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  actionLabel: string;
  secondaryActionLabel?: string;
  note?: string;
  onChange: (value: string) => void;
  onAction: () => void | Promise<unknown>;
  onSecondaryAction?: () => void | Promise<unknown>;
}) {
  return (
    <div className="settings-row settings-row-input">
      <div className="settings-row-copy">
        <strong>{label}</strong>
        <span>{description}</span>
        {note ? <small>{note}</small> : null}
      </div>
      <div className="settings-input-stack">
        <input
          className="settings-input"
          type="password"
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
        <div className="settings-inline-actions">
          <button
            type="button"
            className="settings-button"
            onClick={() => void onAction()}
            disabled={disabled}
          >
            {actionLabel}
          </button>
          {secondaryActionLabel && onSecondaryAction ? (
            <button
              type="button"
              className="settings-button settings-button-ghost"
              onClick={() => void onSecondaryAction()}
              disabled={disabled}
            >
              {secondaryActionLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const formatVoiceApiKeyStatus = (state: VoiceApiKeyState) => {
  if (state.status === "valid") {
    return "Valid";
  }

  if (state.status === "invalid") {
    return "Invalid";
  }

  return state.configured ? "Saved" : "Missing";
};

function BackArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M9.75 3.5 5.25 8l4.5 4.5M5.5 8h5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SettingsPage({
  appInfo,
  appSettingsState,
  isUpdatingAppSettings,
  onUpdateAppSettings,
  sessionState,
  workspaceState,
  timelineState,
  workerSettingsState,
  isUpdatingWorkerSettings,
  onUpdateWorkerSettings,
  voiceMode,
  speakAgentActivity,
  speakToolCalls,
  speakPlanUpdates,
  onUpdateVoicePreferences,
  voiceApiKeyState,
  isSavingVoiceApiKey,
  isTestingVoiceApiKey,
  onSaveVoiceApiKey,
  onClearVoiceApiKey,
  onTestVoiceApiKey,
  inputDevices,
  outputDevices,
  selectedInputDeviceId,
  selectedOutputDeviceId,
  supportsOutputSelection,
  onInputDeviceChange,
  onOutputDeviceChange,
  shouldShowDeviceHint,
  onDismissDeviceHint,
  onResetVoicePreferences,
  archivingThreadId,
  restoringThreadId,
  archiveError,
  onArchiveThread,
  onUnarchiveThread,
  onOpenUserDataDirectory,
  onClearRecentWorkspaces,
  onClose
}: SettingsPageProps) {
  const currentProject = workspaceState.projects.find((project) => project.isCurrent) ?? null;
  const currentThread =
    currentProject?.threads.find((thread) => thread.id === currentProject.currentThreadId) ?? null;
  const settingsRefs = useRef<Record<SettingsSectionKey, HTMLElement | null>>({
    general: null,
    voice: null,
    workers: null,
    notifications: null,
    threads: null,
    privacy: null,
    diagnostics: null
  });

  const selectedModel =
    workerSettingsState.models.find(
      (model) => model.model === workerSettingsState.settings.model
    ) ??
    workerSettingsState.models.find((model) => model.isDefault) ??
    workerSettingsState.models[0] ??
    null;

  const archivedThreadCount = useMemo(
    () =>
      workspaceState.archivedProjects.reduce(
        (count, project) => count + project.threads.length,
        0
      ),
    [workspaceState.archivedProjects]
  );
  const [voiceApiKeyDraft, setVoiceApiKeyDraft] = useState("");

  useEffect(() => {
    if (!voiceApiKeyState.configured) {
      setVoiceApiKeyDraft("");
    }
  }, [voiceApiKeyState.configured]);

  const settingsContentRef = useRef<HTMLDivElement | null>(null);

  const scrollToSection = (key: SettingsSectionKey) => {
    const targetSection = settingsRefs.current[key];
    const container = settingsContentRef.current;

    if (!targetSection || !container) {
      return;
    }

    container.scrollTo({
      top: targetSection.offsetTop,
      behavior: appSettingsState.settings.reduceMotion ? "auto" : "smooth"
    });
  };

  return (
    <section className="settings-page panel stagger-2">
      <div className="settings-page-window-strip" aria-hidden="true" />

      <header className="settings-page-header pane-header">
        <div>
          <h2>Settings</h2>
        </div>
      </header>

      <div className="settings-page-shell">
        <aside className="settings-sidebar">
          <button
            type="button"
            className="settings-button settings-back-button"
            onClick={onClose}
          >
            <BackArrowIcon />
            <span>Back to thread</span>
          </button>
          <nav className="settings-nav" aria-label="Settings sections">
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.key}
                type="button"
                className="settings-nav-button"
                onClick={() => scrollToSection(section.key)}
              >
                {section.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="settings-content" ref={settingsContentRef}>
          <section
            ref={(node) => {
              settingsRefs.current.general = node;
            }}
            className="settings-section"
          >
            <div className="settings-section-head">
              <h3>App behavior</h3>
            </div>
            <div className="settings-card-grid">
              <SectionCard
                title="Launch & restore"
                description="Control how the desktop app comes back after relaunch."
              >
                <ToggleRow
                  label="Launch at login"
                  description="Ask macOS to open the app when you sign in."
                  checked={appSettingsState.settings.launchAtLogin}
                  disabled={isUpdatingAppSettings || !appSettingsState.loginItemSupported}
                  note={!appSettingsState.loginItemSupported ? "Not supported on this platform." : undefined}
                  onChange={(checked) => void onUpdateAppSettings({ launchAtLogin: checked })}
                />
                <ToggleRow
                  label="Restore last workspace"
                  description="Bring back the last repo you had open."
                  checked={appSettingsState.settings.restoreLastWorkspace}
                  disabled={isUpdatingAppSettings}
                  note="Applies next launch."
                  onChange={(checked) => void onUpdateAppSettings({ restoreLastWorkspace: checked })}
                />
                <ToggleRow
                  label="Reopen last thread"
                  description="Jump back into the last thread in that workspace."
                  checked={appSettingsState.settings.reopenLastThread}
                  disabled={isUpdatingAppSettings}
                  note="Applies next launch."
                  onChange={(checked) => void onUpdateAppSettings({ reopenLastThread: checked })}
                />
                <ToggleRow
                  label="Auto-name new chats"
                  description="Ask Codex for a short concise title after the first prompt in a fresh thread."
                  checked={appSettingsState.settings.autoNameNewThreads}
                  disabled={isUpdatingAppSettings}
                  note="Falls back to the opening prompt if Codex does not return a summary."
                  onChange={(checked) => void onUpdateAppSettings({ autoNameNewThreads: checked })}
                />
              </SectionCard>

              <SectionCard
                title="Appearance"
                description="Keep the shell clean without hiding useful signal."
              >
                <SelectRow
                  label="Density"
                  description="Choose how tight the chrome should feel."
                  value={appSettingsState.settings.density}
                  disabled={isUpdatingAppSettings}
                  onChange={(value) =>
                    void onUpdateAppSettings({
                      density: value as AppSettings["density"]
                    })
                  }
                >
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact</option>
                </SelectRow>
                <ThemeSegmentRow
                  label="Theme"
                  description="Pick system default, or force a specific look."
                  value={appSettingsState.settings.theme}
                  disabled={isUpdatingAppSettings}
                  onChange={(value) =>
                    void onUpdateAppSettings({
                      theme: value
                    })
                  }
                />
                <ToggleRow
                  label="Reduce motion"
                  description="Trim animations and smooth scrolling."
                  checked={appSettingsState.settings.reduceMotion}
                  disabled={isUpdatingAppSettings}
                  onChange={(checked) => void onUpdateAppSettings({ reduceMotion: checked })}
                />
                <ToggleRow
                  label="Developer mode"
                  description="Show extra diagnostics and debugging signal."
                  checked={appSettingsState.settings.developerMode}
                  disabled={isUpdatingAppSettings}
                  onChange={(checked) => void onUpdateAppSettings({ developerMode: checked })}
                />
              </SectionCard>
            </div>
          </section>

          <section
            ref={(node) => {
              settingsRefs.current.voice = node;
            }}
            className="settings-section"
          >
            <div className="settings-section-head">
              <h3>Devices & captions</h3>
            </div>
            <div className="settings-card-grid settings-card-grid-wide settings-voice-card-grid">
              <div className="settings-voice-stack">
                <SectionCard
                  title="Provider & authentication"
                  description="Choose mode and connect your OpenAI key."
                >
                  <SelectRow
                    label="Mode"
                    description="Choose voice latency vs reliability."
                    value={voiceMode}
                    onChange={(value) =>
                      void onUpdateVoicePreferences({
                        mode: value as VoiceMode
                      })
                    }
                  >
                    <option value="transcription">Transcription (recommended)</option>
                    <option value="realtime">Voice realtime</option>
                  </SelectRow>
                  <InputActionRow
                    label="OpenAI API key"
                    description="Stored in main process only."
                    value={voiceApiKeyDraft}
                    placeholder="sk-..."
                    disabled={isSavingVoiceApiKey}
                    actionLabel={isSavingVoiceApiKey ? "Saving..." : "Save"}
                    secondaryActionLabel={voiceApiKeyState.configured ? "Clear" : undefined}
                    note={
                      voiceApiKeyState.error
                        ? `${formatVoiceApiKeyStatus(voiceApiKeyState)}: ${voiceApiKeyState.error}`
                        : `${formatVoiceApiKeyStatus(voiceApiKeyState)}${
                            voiceApiKeyState.lastValidatedAt
                              ? ` • checked ${new Date(voiceApiKeyState.lastValidatedAt).toLocaleString()}`
                              : ""
                          }`
                    }
                    onChange={setVoiceApiKeyDraft}
                    onAction={() => onSaveVoiceApiKey(voiceApiKeyDraft)}
                    onSecondaryAction={voiceApiKeyState.configured ? onClearVoiceApiKey : undefined}
                  />
                  <ActionRow
                    label="Test connection"
                    description="Check current key + selected mode."
                    actionLabel={isTestingVoiceApiKey ? "Testing..." : "Test"}
                    disabled={isTestingVoiceApiKey || isSavingVoiceApiKey || !voiceApiKeyState.configured}
                    onAction={onTestVoiceApiKey}
                  />
                </SectionCard>

                <SectionCard
                  title="Speech behavior"
                  description="Tune how voice updates sound."
                >
                  <ToggleRow
                    label="Speak agent activity"
                    description="Speak short state updates while Codex works."
                    checked={speakAgentActivity}
                    onChange={(checked) =>
                      void onUpdateVoicePreferences({
                        speakAgentActivity: checked
                      })
                    }
                  />
                  <ToggleRow
                    label="Speak tool calls"
                    description="Speak concise tool execution updates."
                    checked={speakToolCalls}
                    onChange={(checked) =>
                      void onUpdateVoicePreferences({
                        speakToolCalls: checked
                      })
                    }
                  />
                  <ToggleRow
                    label="Speak plan updates"
                    description="Speak key plan and checklist changes."
                    checked={speakPlanUpdates}
                    onChange={(checked) =>
                      void onUpdateVoicePreferences({
                        speakPlanUpdates: checked
                      })
                    }
                  />
                  <ToggleRow
                    label="Auto-start voice"
                    description="Start voice automatically when repo is ready."
                    checked={appSettingsState.settings.autoStartVoice}
                    disabled={isUpdatingAppSettings}
                    onChange={(checked) => void onUpdateAppSettings({ autoStartVoice: checked })}
                  />
                  <ToggleRow
                    label="Show captions"
                    description="Display live transcript text."
                    checked={appSettingsState.settings.showVoiceCaptions}
                    disabled={isUpdatingAppSettings}
                    onChange={(checked) => void onUpdateAppSettings({ showVoiceCaptions: checked })}
                  />
                  <ToggleRow
                    label="Show setup tip"
                    description="Keep setup guidance visible."
                    checked={shouldShowDeviceHint}
                    onChange={(checked) => {
                      if (checked) {
                        void onResetVoicePreferences();
                      } else {
                        onDismissDeviceHint();
                      }
                    }}
                  />
                </SectionCard>
              </div>

              <div className="settings-voice-device-card">
                <SectionCard
                  title="Devices"
                  description="Input and output mapping."
                >
                  <div className="settings-voice-device-compact">
                    <SelectRow
                      label="Microphone"
                      description="Audio source for speech."
                      value={selectedInputDeviceId}
                      onChange={onInputDeviceChange}
                    >
                      {inputDevices.map((device) => (
                        <option key={`input-${device.id || "default"}`} value={device.id}>
                          {device.label}
                        </option>
                      ))}
                    </SelectRow>
                    <SelectRow
                      label="Speaker"
                      description="Where voice audio plays."
                      value={selectedOutputDeviceId}
                      disabled={!supportsOutputSelection}
                      onChange={onOutputDeviceChange}
                    >
                      {outputDevices.map((device) => (
                        <option key={`output-${device.id || "default"}`} value={device.id}>
                          {device.label}
                        </option>
                      ))}
                    </SelectRow>
                    <ActionRow
                      label="Reset voice preferences"
                      description="Clear saved devices and setup state."
                      actionLabel="Reset"
                      onAction={onResetVoicePreferences}
                    />
                  </div>
                </SectionCard>
              </div>
            </div>
          </section>

          <section
            ref={(node) => {
              settingsRefs.current.workers = node;
            }}
            className="settings-section"
          >
            <div className="settings-section-head">
              <h3>Default execution profile</h3>
            </div>
            <div className="settings-card-grid settings-card-grid-wide">
              <SectionCard
                title="New-thread defaults"
                description="These controls govern worker turns. New chats start from config.toml until you override them here."
              >
                <SelectRow
                  label="Model"
                  description={selectedModel?.description || "Choose the worker model."}
                  value={workerSettingsState.settings.model ?? ""}
                  disabled={isUpdatingWorkerSettings}
                  onChange={(value) =>
                    void onUpdateWorkerSettings({
                      model: value || null
                    })
                  }
                >
                  <option value="">
                    {selectedModel?.label ? `${selectedModel.label} (default)` : "Auto default"}
                  </option>
                  {workerSettingsState.models.map((model) => (
                    <option key={model.id} value={model.model}>
                      {model.label}
                    </option>
                  ))}
                </SelectRow>

                <SelectRow
                  label="Reasoning effort"
                  description="Higher effort helps on deeper multi-step work."
                  value={workerSettingsState.settings.reasoningEffort}
                  disabled={isUpdatingWorkerSettings}
                  onChange={(value) =>
                    void onUpdateWorkerSettings({
                      reasoningEffort: value as WorkerReasoningEffort
                    })
                  }
                >
                  {(selectedModel?.supportedReasoningEfforts.length
                    ? selectedModel.supportedReasoningEfforts
                    : (["high"] as WorkerReasoningEffort[])
                  ).map((effort) => (
                    <option key={effort} value={effort}>
                      {REASONING_LABELS[effort]}
                    </option>
                  ))}
                </SelectRow>

                <ToggleRow
                  label="Fast mode"
                  description="Prefer fast tier execution when the model supports it."
                  checked={workerSettingsState.settings.fastMode}
                  disabled={isUpdatingWorkerSettings}
                  onChange={(checked) => void onUpdateWorkerSettings({ fastMode: checked })}
                />

                <SelectRow
                  label="Approval policy"
                  description="Choose how much worker side-effecting work can do without interruption."
                  value={workerSettingsState.settings.approvalPolicy}
                  disabled={isUpdatingWorkerSettings}
                  onChange={(value) =>
                    void onUpdateWorkerSettings({
                      approvalPolicy: value as WorkerApprovalPolicy
                    })
                  }
                >
                  {(Object.keys(APPROVAL_LABELS) as WorkerApprovalPolicy[]).map((policy) => (
                    <option key={policy} value={policy}>
                      {APPROVAL_LABELS[policy]}
                    </option>
                  ))}
                </SelectRow>
              </SectionCard>

              <SectionCard
                title="Execution notes"
                description="What the current model and policy imply."
              >
                <div className="settings-note-stack">
                  <div className="settings-inline-note">
                    <strong>{selectedModel?.label ?? "Default model"}</strong>
                    <span>
                      {selectedModel?.supportsImageInput
                        ? "Supports image attachments."
                        : "File mentions only; images are sent as file context."}
                    </span>
                  </div>
                  <div className="settings-inline-note">
                    <strong>{REASONING_LABELS[workerSettingsState.settings.reasoningEffort]}</strong>
                    <span>Current default reasoning effort.</span>
                  </div>
                  <div className="settings-inline-note">
                    <strong>{APPROVAL_LABELS[workerSettingsState.settings.approvalPolicy]}</strong>
                    <span>Current approval mode for new work.</span>
                  </div>
                </div>
              </SectionCard>
            </div>
          </section>

          <section
            ref={(node) => {
              settingsRefs.current.notifications = node;
            }}
            className="settings-section"
          >
            <div className="settings-section-head">
              <h3>Desktop alerts</h3>
            </div>
            <div className="settings-card-grid">
              <SectionCard
                title="Desktop notifications"
                description="Only send alerts when you actually need to come back."
              >
                <ToggleRow
                  label="Enable desktop notifications"
                  description="Master switch for all local alerts."
                  checked={appSettingsState.settings.desktopNotifications}
                  disabled={isUpdatingAppSettings || !appSettingsState.notificationsSupported}
                  note={
                    !appSettingsState.notificationsSupported
                      ? "Notifications are not supported in this runtime."
                      : undefined
                  }
                  onChange={(checked) =>
                    void onUpdateAppSettings({ desktopNotifications: checked })
                  }
                />
                <ToggleRow
                  label="Approvals"
                  description="Alert when work is blocked on a command or file approval."
                  checked={appSettingsState.settings.notifyOnApprovals}
                  disabled={
                    isUpdatingAppSettings || !appSettingsState.settings.desktopNotifications
                  }
                  onChange={(checked) =>
                    void onUpdateAppSettings({ notifyOnApprovals: checked })
                  }
                />
                <ToggleRow
                  label="Turn complete"
                  description="Alert when a worker finishes a task."
                  checked={appSettingsState.settings.notifyOnTurnComplete}
                  disabled={
                    isUpdatingAppSettings || !appSettingsState.settings.desktopNotifications
                  }
                  onChange={(checked) =>
                    void onUpdateAppSettings({ notifyOnTurnComplete: checked })
                  }
                />
                <ToggleRow
                  label="Errors"
                  description="Alert when the app or worker hits a hard failure."
                  checked={appSettingsState.settings.notifyOnErrors}
                  disabled={
                    isUpdatingAppSettings || !appSettingsState.settings.desktopNotifications
                  }
                  onChange={(checked) =>
                    void onUpdateAppSettings({ notifyOnErrors: checked })
                  }
                />
              </SectionCard>
            </div>
          </section>

          <section
            ref={(node) => {
              settingsRefs.current.threads = node;
            }}
            className="settings-section"
          >
            <div className="settings-section-head">
              <h3>History & archives</h3>
            </div>
            <div className="settings-card-grid settings-card-grid-wide">
              <SectionCard
                title="Current workspace"
                description="Thread and repo behavior for the active session."
              >
                <div className="settings-note-stack">
                  <div className="settings-inline-note">
                    <strong>{currentProject?.name ?? "No repo open"}</strong>
                    <span>{currentProject?.path ?? "Open a repo to bind a workspace."}</span>
                  </div>
                  <div className="settings-inline-note">
                    <strong>{currentThread?.title ?? "No active thread"}</strong>
                    <span>{timelineState.threadId ?? "A thread id appears once work starts."}</span>
                  </div>
                  <div className="settings-inline-note">
                    <strong>{workspaceState.recentWorkspaces.length}</strong>
                    <span>Recent workspaces remembered locally.</span>
                  </div>
                </div>
                {currentProject && currentThread ? (
                  <ActionRow
                    label="Archive current chat"
                    description="Move the selected thread out of the active list."
                    actionLabel={archivingThreadId === currentThread.id ? "Archiving..." : "Archive"}
                    disabled={archivingThreadId === currentThread.id || timelineState.isRunning}
                    onAction={() => onArchiveThread(currentProject.id, currentThread.id)}
                  />
                ) : null}
                <ActionRow
                  label="Clear recent workspaces"
                  description="Forget older repos but keep the current one open."
                  actionLabel="Clear"
                  onAction={onClearRecentWorkspaces}
                />
              </SectionCard>

              <SectionCard
                title="Archived chats"
                description="Archive lives here now. Restore anything back into the active list."
              >
                {workspaceState.archivedProjects.length > 0 ? (
                  <div className="settings-archive-list">
                    {workspaceState.archivedProjects.map((project) => (
                      <section key={project.id} className="settings-archive-project">
                        <div className="settings-archive-project-head">
                          <strong>{project.name}</strong>
                          <span>{project.threads.length} archived</span>
                        </div>
                        <div className="settings-archive-thread-list">
                          {project.threads.map((thread) => (
                            <div key={thread.id} className="settings-archive-thread-row">
                              <div className="settings-archive-thread-copy">
                                <strong>{thread.title}</strong>
                                <span>{thread.updatedAt}</span>
                              </div>
                              <div className="settings-archive-thread-actions">
                                <button
                                  type="button"
                                  className="settings-button"
                                  onClick={() => void onUnarchiveThread(project.id, thread.id)}
                                  disabled={restoringThreadId === thread.id}
                                >
                                  {restoringThreadId === thread.id ? "Restoring..." : "Restore"}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="settings-empty-note">
                    <strong>No archived chats</strong>
                    <span>Archive items from the thread list hover action.</span>
                  </div>
                )}
                {archiveError ? <p className="settings-error-note">{archiveError}</p> : null}
                <div className="settings-inline-note">
                  <strong>{archivedThreadCount}</strong>
                  <span>Total archived threads across all remembered workspaces.</span>
                </div>
              </SectionCard>
            </div>
          </section>

          <section
            ref={(node) => {
              settingsRefs.current.privacy = node;
            }}
            className="settings-section"
          >
            <div className="settings-section-head">
              <h3>Local data & storage</h3>
            </div>
            <div className="settings-card-grid">
              <SectionCard
                title="Local storage"
                description="Keep the data story explicit."
              >
                <div className="settings-note-stack">
                  <div className="settings-inline-note">
                    <strong>Transcript history</strong>
                    <span>Stored locally for threads and timeline replay.</span>
                  </div>
                  <div className="settings-inline-note">
                    <strong>Raw audio</strong>
                    <span>Not persisted by the app.</span>
                  </div>
                  <div className="settings-inline-note">
                    <strong>User data path</strong>
                    <span>{appSettingsState.userDataPath}</span>
                  </div>
                </div>
                <ActionRow
                  label="Open local data folder"
                  description="Inspect JSON state, cached prefs, and other local app files."
                  actionLabel="Open folder"
                  onAction={onOpenUserDataDirectory}
                />
              </SectionCard>
            </div>
          </section>

          <section
            ref={(node) => {
              settingsRefs.current.diagnostics = node;
            }}
            className="settings-section"
          >
            <div className="settings-section-head">
              <h3>Session & features</h3>
            </div>
            <div className="settings-card-grid settings-card-grid-wide">
              <SectionCard
                title="Account"
                description="Current Codex / ChatGPT session backing the app."
              >
                <div className="settings-note-stack">
                  <div className="settings-inline-note">
                    <strong>{sessionState?.status ?? "connecting"}</strong>
                    <span>Session status.</span>
                  </div>
                  <div className="settings-inline-note">
                    <strong>{sessionState?.account?.type ?? "unknown"}</strong>
                    <span>{sessionState?.account?.planType ?? "No plan surfaced."}</span>
                  </div>
                  <div className="settings-inline-note">
                    <strong>{appInfo?.name ?? "Codex Realtime"}</strong>
                    <span>{appInfo ? `${appInfo.version} · ${appInfo.platform}` : "Local build"}</span>
                  </div>
                  {appSettingsState.settings.developerMode ? (
                    <div className="settings-inline-note">
                      <strong>{timelineState.threadId ?? "no-thread"}</strong>
                      <span>{timelineState.runState.label ?? "No live timeline state."}</span>
                    </div>
                  ) : null}
                </div>
              </SectionCard>

              <SectionCard
                title="Voice runtime"
                description="Separate OpenAI voice lane status."
              >
                <div className="settings-feature-grid">
                  <div className="settings-feature-pill">
                    <strong>Mode</strong>
                    <span>{voiceMode === "transcription" ? "Transcription" : "Realtime"}</span>
                  </div>
                  <div className="settings-feature-pill">
                    <strong>API key</strong>
                    <span>{formatVoiceApiKeyStatus(voiceApiKeyState)}</span>
                  </div>
                  <div className="settings-feature-pill">
                    <strong>Codex clarify mode</strong>
                    <span>
                      {sessionState?.features.defaultModeRequestUserInput ? "Enabled" : "Unavailable"}
                    </span>
                  </div>
                </div>
              </SectionCard>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
