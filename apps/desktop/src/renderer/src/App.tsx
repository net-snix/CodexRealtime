import { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";
import type {
  ApprovalDecision,
  ArchiveThreadResult,
  AppInfo,
  SessionState,
  TimelineState,
  TurnStartRequest,
  WorkspaceState
} from "@shared";
import { LeftRail } from "./components/LeftRail";
import { RightPane } from "./components/RightPane";
import { SettingsPage } from "./components/SettingsPage";
import { Timeline } from "./components/Timeline";
import { useAppSettings } from "./use-app-settings";
import { useRealtimeVoice } from "./use-realtime-voice";
import { useWorkerSettings } from "./use-worker-settings";
import { VoiceBar } from "./components/VoiceBar";
import {
  applyArchiveThreadTransition,
  applyCreateThreadTransition,
  applySelectThreadTransition,
  applyUnarchiveThreadTransition
} from "./workspace-state-transitions";
import {
  applyOptimisticTurnStart,
  createOptimisticUserEventId,
  removeOptimisticTurnStart
} from "./timeline-state-transitions";
import { ensureNativeApi } from "./native-api";

type PaneKey = "plan" | "diff";
type MainView = "thread" | "settings";
type VoiceFeedbackTone = "neutral" | "success" | "error";
type VoiceFeedback = {
  tone: VoiceFeedbackTone;
  text: string;
} | null;

const emptyTimelineState: TimelineState = {
  threadId: null,
  entries: [],
  activePlan: null,
  latestProposedPlan: null,
  turnDiffs: [],
  activeDiffPreview: null,
  isRunning: false,
  runState: {
    phase: "idle",
    label: null
  },
  approvals: [],
  userInputs: [],
  activeWorkStartedAt: null,
  latestTurn: null
};

const filterStateMap = <T,>(stateMap: Record<string, T>, activeIds: Set<string>) =>
  Object.fromEntries(Object.entries(stateMap).filter(([id]) => activeIds.has(id))) as Record<string, T>;

const omitStateKey = <T,>(stateMap: Record<string, T>, key: string) => {
  if (!(key in stateMap)) {
    return stateMap;
  }

  const nextState = { ...stateMap };
  delete nextState[key];
  return nextState;
};

const toErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message.trim() ? error.message : fallback;

const toThreadDraftTitle = (prompt: string) => {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, 72) : "New thread";
};

export default function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>({
    currentWorkspace: null,
    currentThreadId: null,
    recentWorkspaces: [],
    threads: [],
    projects: [],
    archivedProjects: []
  });
  const currentProject = workspaceState.projects.find((project) => project.isCurrent) ?? null;
  const currentWorkspaceId = currentProject?.id ?? null;
  const currentThreadId = currentProject?.currentThreadId ?? null;
  const workerSettingsKey = currentWorkspaceId
    ? `${currentWorkspaceId}:${currentThreadId ?? "draft"}`
    : "global";
  const {
    settingsState: appSettingsState,
    isUpdating: isUpdatingAppSettings,
    updateSettings: updateAppSettings
  } = useAppSettings();
  const {
    settingsState: workerSettingsState,
    attachments: workerAttachments,
    isUpdating: isUpdatingWorkerSettings,
    isPickingAttachments,
    updateSettings: updateWorkerSettings,
    pickAttachments: pickWorkerAttachments,
    addAttachments: addWorkerAttachments,
    addPastedImageAttachments,
    removeAttachment: removeWorkerAttachment,
    clearAttachments: clearWorkerAttachments
  } = useWorkerSettings(workerSettingsKey);
  const [timelineState, setTimelineState] = useState<TimelineState>(emptyTimelineState);
  const [isOpeningWorkspace, setIsOpeningWorkspace] = useState(false);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [isStartingTurn, setIsStartingTurn] = useState(false);
  const [isStoppingVoice, setIsStoppingVoice] = useState(false);
  const [voiceFeedback, setVoiceFeedback] = useState<VoiceFeedback>(null);
  const [mainView, setMainView] = useState<MainView>("thread");
  const [activePane, setActivePane] = useState<PaneKey>("plan");
  const [isRightPaneOpen, setIsRightPaneOpen] = useState(true);
  const [submittingApprovals, setSubmittingApprovals] = useState<Record<string, ApprovalDecision>>({});
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string>>({});
  const [submittingUserInputs, setSubmittingUserInputs] = useState<Record<string, boolean>>({});
  const [userInputErrors, setUserInputErrors] = useState<Record<string, string>>({});
  const [archivingThreadId, setArchivingThreadId] = useState<string | null>(null);
  const [restoringThreadId, setRestoringThreadId] = useState<string | null>(null);
  const [removingWorkspaceId, setRemovingWorkspaceId] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const autoStartedVoiceKeyRef = useRef<string | null>(null);
  const previousApprovalCountRef = useRef(0);
  const previousIsRunningRef = useRef(false);
  const previousStatusRef = useRef<string | null>(null);
  const timelineRefreshPromiseRef = useRef<Promise<TimelineState> | null>(null);
  const nativeApiRef = useRef<ReturnType<typeof ensureNativeApi> | null>(null);
  if (!nativeApiRef.current) {
    nativeApiRef.current = ensureNativeApi();
  }
  const realtimeEnabled = Boolean(
    sessionState?.status === "connected" &&
      sessionState.features.realtimeConversation &&
      currentProject
  );
  const {
    voiceState,
    realtimeState,
    liveTranscript,
    inputDevices,
    outputDevices,
    selectedInputDeviceId,
    selectedOutputDeviceId,
    supportsOutputSelection,
    shouldShowDeviceHint,
    dismissDeviceHint,
    resetVoicePreferences,
    setSelectedInputDeviceId,
    setSelectedOutputDeviceId,
    isActive: isVoiceActive,
    start: startVoice,
    stop: stopVoice
  } =
    useRealtimeVoice({
      enabled: realtimeEnabled,
      onVoiceIntent: async (intent) => {
        try {
          const nextTimeline = await nativeApiRef.current!.dispatchVoiceIntent(intent);
          setTimelineState(nextTimeline);

          if (intent.kind === "conversation") {
            setVoiceFeedback({
              tone: "neutral",
              text: "Kept this in conversation"
            });
            return;
          }

          if (nextTimeline.runState.phase === "steering") {
            setVoiceFeedback({
              tone: "success",
              text: "Steered active turn from voice"
            });
            return;
          }

          if (nextTimeline.isRunning) {
            setVoiceFeedback({
              tone: "success",
              text:
                intent.source.sourceType === "handoff_request"
                  ? "Started Codex handoff from voice"
                  : "Started Codex work from voice"
            });
          }
        } catch (error) {
          console.error("Voice intent dispatch failed", error);
          setVoiceFeedback({
            tone: "error",
            text: toErrorMessage(error, "Voice handoff failed")
          });
        }
      }
    });
  const approvalCount = timelineState.approvals?.length ?? 0;
  const userInputCount = timelineState.userInputs?.length ?? 0;
  const appSettings = appSettingsState.settings;
  const isMacos = appInfo?.platform === "darwin";
  const submittingApprovalCount = Object.keys(submittingApprovals).length;
  const submittingUserInputCount = Object.keys(submittingUserInputs).length;
  const isTimelinePolling =
    timelineState.isRunning ||
    approvalCount > 0 ||
    userInputCount > 0 ||
    submittingApprovalCount > 0 ||
    submittingUserInputCount > 0;

  const refreshTimelineState = useEffectEvent(async () => {
    if (timelineRefreshPromiseRef.current) {
      return timelineRefreshPromiseRef.current;
    }

    const request = nativeApiRef.current!
      .getTimelineState()
      .then((nextTimeline) => {
        setTimelineState(nextTimeline);
        return nextTimeline;
      })
      .finally(() => {
        if (timelineRefreshPromiseRef.current === request) {
          timelineRefreshPromiseRef.current = null;
        }
      });

    timelineRefreshPromiseRef.current = request;
    return request;
  });

  useEffect(() => {
    void Promise.allSettled([
      nativeApiRef.current!.getAppInfo(),
      nativeApiRef.current!.getSessionState(),
      nativeApiRef.current!.getWorkspaceState(),
      nativeApiRef.current!.getTimelineState()
    ]).then(([appInfoResult, sessionResult, workspaceResult, timelineResult]) => {
      if (appInfoResult.status === "fulfilled") {
        setAppInfo(appInfoResult.value);
      } else {
        setAppInfo({
          name: "Codex Realtime",
          version: "0.1.0",
          platform: "darwin",
          availableEditors: []
        });
      }

      if (sessionResult.status === "fulfilled") {
        setSessionState(sessionResult.value);
      } else {
        setSessionState({
          status: "error",
          account: null,
          features: {
            defaultModeRequestUserInput: false,
            realtimeConversation: false,
            voiceTranscription: false
          },
          requiresOpenaiAuth: true,
          error: "Could not read Codex session state",
          lastUpdatedAt: null
        });
      }

      if (workspaceResult.status === "fulfilled") {
        setWorkspaceState(workspaceResult.value);
      }

      if (timelineResult.status === "fulfilled") {
        setTimelineState(timelineResult.value);
      } else {
        setTimelineState({
          ...emptyTimelineState,
          runState: {
            phase: "historyUnavailable",
            label: "Timeline unavailable"
          }
        });
      }
    });
  }, []);

  useEffect(() => {
    const unsubscribe = nativeApiRef.current!.subscribeTimelineUpdates((nextTimeline) => {
      setTimelineState(nextTimeline);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isTimelinePolling) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshTimelineState();
    }, 900);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    approvalCount,
    isTimelinePolling,
    refreshTimelineState,
    timelineState.isRunning,
    timelineState.threadId,
    userInputCount
  ]);

  useEffect(() => {
    if (
      !currentProject ||
      currentThreadId ||
      currentProject.threads.length === 0
    ) {
      return;
    }

    let cancelled = false;

    void nativeApiRef.current!
      .selectThread(currentProject.id, currentProject.threads[0].id)
      .then((nextTimeline) => {
        if (cancelled) {
          return;
        }

        setTimelineState(nextTimeline);
        startTransition(() => {
          setWorkspaceState((current) =>
            applySelectThreadTransition(current, {
              workspaceId: currentProject.id,
              threadId: currentProject.threads[0]?.id ?? nextTimeline.threadId ?? ""
            })
          );
        });
      })
      .catch((error) => {
        console.error("Failed to bind the latest thread", error);
      });

    return () => {
      cancelled = true;
    };
  }, [currentProject, currentThreadId]);

  const handleOpenWorkspace = async () => {
    setIsOpeningWorkspace(true);

    try {
      const nextState = await nativeApiRef.current!.openWorkspace();
      setWorkspaceState(nextState);
      setMainView("thread");
      await refreshTimelineState();
      window.focus();
    } finally {
      setIsOpeningWorkspace(false);
    }
  };

  const handleSelectWorkspace = async (workspaceId: string) => {
    if (isVoiceActive) {
      await stopVoice();
    }

    const nextState = await nativeApiRef.current!.selectWorkspace(workspaceId);
    setWorkspaceState(nextState);
    setMainView("thread");
    await refreshTimelineState();
  };

  const handleSelectThread = async (workspaceId: string, threadId: string) => {
    if (!threadId || (workspaceId === currentWorkspaceId && threadId === currentThreadId)) {
      return;
    }

    if (isVoiceActive) {
      await stopVoice();
    }

    const nextTimeline = await nativeApiRef.current!.selectThread(workspaceId, threadId);
    setTimelineState(nextTimeline);
    startTransition(() => {
      setWorkspaceState((current) =>
        applySelectThreadTransition(current, {
          workspaceId,
          threadId
        })
      );
    });
    setMainView("thread");
  };

  const handleCreateThread = async (workspaceId: string) => {
    if (!workspaceId) {
      return;
    }

    setIsCreatingThread(true);

    try {
      if (isVoiceActive) {
        await stopVoice();
      }

      const nextTimeline = await nativeApiRef.current!.createThread(workspaceId);
      const threadId = nextTimeline.threadId;
      setTimelineState(nextTimeline);
      if (threadId) {
        startTransition(() => {
          setWorkspaceState((current) =>
            applyCreateThreadTransition(current, {
              workspaceId,
              threadId,
              title: "New thread"
            })
          );
        });
      }
      setMainView("thread");
    } finally {
      setIsCreatingThread(false);
    }
  };

  const handleRemoveWorkspace = async (workspaceId: string) => {
    setRemovingWorkspaceId(workspaceId);

    try {
      if (isVoiceActive && currentWorkspaceId === workspaceId) {
        await stopVoice();
      }

      const nextState = await nativeApiRef.current!.removeWorkspace(workspaceId);
      setWorkspaceState(nextState);
      clearWorkerAttachments();
      setMainView("thread");
      await refreshTimelineState();
    } finally {
      setRemovingWorkspaceId(null);
    }
  };

  const handleArchiveThread = async (workspaceId: string, threadId: string) => {
    setArchiveError(null);
    setArchivingThreadId(threadId);
    const isArchivingCurrentThread = currentWorkspaceId === workspaceId && currentThreadId === threadId;

    try {
      if (isVoiceActive && isArchivingCurrentThread) {
        await stopVoice();
      }

      const result: ArchiveThreadResult = await nativeApiRef.current!.archiveThread(workspaceId, threadId);
      setTimelineState(result.timelineState);
      startTransition(() => {
        setWorkspaceState((current) =>
          applyArchiveThreadTransition(current, {
            workspaceId: result.workspaceId,
            threadId: result.archivedThreadId,
            nextThreadId: result.selectedThreadId
          })
        );
      });

      if (isArchivingCurrentThread) {
        clearWorkerAttachments();
        setActivePane("plan");
        setMainView(
          mainView === "settings" ? "settings" : result.selectedThreadId ? "thread" : "settings"
        );
      }
    } catch (error) {
      setArchiveError(toErrorMessage(error, "Archiving thread failed."));
    } finally {
      setArchivingThreadId(null);
    }
  };

  const handleUnarchiveThread = async (workspaceId: string, threadId: string) => {
    setArchiveError(null);
    setRestoringThreadId(threadId);

    try {
      if (isVoiceActive) {
        await stopVoice();
      }

      const nextTimeline = await nativeApiRef.current!.unarchiveThread(workspaceId, threadId);
      setTimelineState(nextTimeline);
      startTransition(() => {
        setWorkspaceState((current) =>
          applyUnarchiveThreadTransition(current, {
            workspaceId,
            threadId
          })
        );
      });
      setActivePane("plan");
      setMainView("thread");
    } catch (error) {
      setArchiveError(toErrorMessage(error, "Restoring archived thread failed."));
    } finally {
      setRestoringThreadId(null);
    }
  };

  const handleStartTurn = async (request: TurnStartRequest) => {
    setIsStartingTurn(true);
    const optimisticEventId = createOptimisticUserEventId();
    setTimelineState((current) => applyOptimisticTurnStart(current, request.prompt, optimisticEventId));

    try {
      const nextTimeline = await nativeApiRef.current!.startTurn(request);
      const threadId = nextTimeline.threadId;
      setTimelineState(nextTimeline);
      if (currentWorkspaceId && threadId) {
        if (appSettings.autoNameNewThreads) {
          try {
            const nextWorkspaceState = await nativeApiRef.current!.getWorkspaceState();
            setWorkspaceState(nextWorkspaceState);
          } catch {
            startTransition(() => {
              setWorkspaceState((current) =>
                applyCreateThreadTransition(current, {
                  workspaceId: currentWorkspaceId,
                  threadId,
                  title: toThreadDraftTitle(request.prompt)
                })
              );
            });
          }
        } else {
          startTransition(() => {
            setWorkspaceState((current) =>
              applyCreateThreadTransition(current, {
                workspaceId: currentWorkspaceId,
                threadId,
                title: toThreadDraftTitle(request.prompt)
              })
            );
          });
        }
      }
      clearWorkerAttachments();
      setMainView("thread");
    } catch (error) {
      setTimelineState((current) => removeOptimisticTurnStart(current, optimisticEventId));
      throw error;
    } finally {
      setIsStartingTurn(false);
    }
  };

  const handleStopVoice = async () => {
    setIsStoppingVoice(true);

    try {
      if (timelineState.isRunning) {
        const nextTimeline = await nativeApiRef.current!.interruptActiveTurn();
        setTimelineState(nextTimeline);
        setVoiceFeedback({
          tone: "success",
          text: "Interrupted active turn"
        });
      }
    } finally {
      if (isVoiceActive) {
        await stopVoice();
      }
    }
  };

  useEffect(() => {
    if (isStoppingVoice && !timelineState.isRunning && !isVoiceActive) {
      setIsStoppingVoice(false);
    }
  }, [isStoppingVoice, isVoiceActive, timelineState.isRunning]);

  useEffect(() => {
    if (!voiceFeedback || isStoppingVoice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setVoiceFeedback(null);
    }, 2600);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isStoppingVoice, voiceFeedback]);

  useEffect(() => {
    const activeApprovalIds = new Set((timelineState.approvals ?? []).map((approval) => approval.id));
    const activeUserInputIds = new Set((timelineState.userInputs ?? []).map((prompt) => prompt.id));

    setSubmittingApprovals((current) => filterStateMap(current, activeApprovalIds));
    setApprovalErrors((current) => filterStateMap(current, activeApprovalIds));
    setSubmittingUserInputs((current) => filterStateMap(current, activeUserInputIds));
    setUserInputErrors((current) => filterStateMap(current, activeUserInputIds));
  }, [timelineState.approvals, timelineState.userInputs]);

  useEffect(() => {
    if (!appSettings.autoStartVoice || !realtimeEnabled || isVoiceActive || mainView !== "thread") {
      return;
    }

    const autoStartKey = currentProject && currentThreadId
      ? `${currentProject.id}:${currentThreadId}`
      : currentProject
        ? `${currentProject.id}:draft`
        : null;

    if (!autoStartKey || autoStartedVoiceKeyRef.current === autoStartKey) {
      return;
    }

    autoStartedVoiceKeyRef.current = autoStartKey;
    void startVoice().catch((error) => {
      console.error("Auto-start voice failed", error);
      autoStartedVoiceKeyRef.current = null;
    });
  }, [
    appSettings.autoStartVoice,
    currentProject,
    currentThreadId,
    isVoiceActive,
    mainView,
    realtimeEnabled,
    startVoice
  ]);

  useEffect(() => {
    if (!appSettings.desktopNotifications) {
      previousApprovalCountRef.current = approvalCount;
      previousIsRunningRef.current = timelineState.isRunning;
      previousStatusRef.current = sessionState?.status ?? null;
      return;
    }

    if (
      appSettings.notifyOnApprovals &&
      approvalCount > previousApprovalCountRef.current
    ) {
      void nativeApiRef.current!.showDesktopNotification({
        title: "Approval needed",
        body: `${approvalCount} approval request${approvalCount === 1 ? "" : "s"} waiting`
      });
    }

    if (
      appSettings.notifyOnTurnComplete &&
      previousIsRunningRef.current &&
      !timelineState.isRunning &&
      Boolean(timelineState.threadId) &&
      timelineState.runState.phase !== "interrupted"
    ) {
      void nativeApiRef.current!.showDesktopNotification({
        title: "Worker finished",
        body: timelineState.runState.label ?? "Task complete"
      });
    }

    if (
      appSettings.notifyOnErrors &&
      sessionState?.status === "error" &&
      previousStatusRef.current !== "error"
    ) {
      void nativeApiRef.current!.showDesktopNotification({
        title: "Codex session error",
        body: sessionState.error ?? "Session needs attention"
      });
    }

    previousApprovalCountRef.current = approvalCount;
    previousIsRunningRef.current = timelineState.isRunning;
    previousStatusRef.current = sessionState?.status ?? null;
  }, [
    appSettings.desktopNotifications,
    appSettings.notifyOnApprovals,
    appSettings.notifyOnErrors,
    appSettings.notifyOnTurnComplete,
    approvalCount,
    sessionState?.error,
    sessionState?.status,
    timelineState.isRunning,
    timelineState.runState.label,
    timelineState.runState.phase,
    timelineState.threadId
  ]);

  const handleOpenSettings = () => {
    setMainView("settings");
  };

  const handleCloseSettings = () => {
    setMainView("thread");
  };

  const handleOpenUserDataDirectory = async () => {
    await nativeApiRef.current!.openUserDataDirectory();
  };

  const handleClearRecentWorkspaces = async () => {
    const nextWorkspaceState = await nativeApiRef.current!.clearRecentWorkspaces();
    setWorkspaceState(nextWorkspaceState);
  };

  const handleResetVoicePreferences = async () => {
    await resetVoicePreferences();
  };

  const handleApproveRequest = async (id: string, decision: ApprovalDecision = "accept") => {
    setApprovalErrors((current) => omitStateKey(current, id));
    setSubmittingApprovals((current) => ({ ...current, [id]: decision }));

    try {
      const nextTimeline = await nativeApiRef.current!.respondToApproval(id, decision);
      setTimelineState(nextTimeline);
    } catch (error) {
      setApprovalErrors((current) => ({
        ...current,
        [id]: toErrorMessage(error, "Approve request failed.")
      }));
    } finally {
      setSubmittingApprovals((current) => omitStateKey(current, id));
    }
  };

  const handleDenyRequest = async (id: string) => {
    setApprovalErrors((current) => omitStateKey(current, id));
    setSubmittingApprovals((current) => ({ ...current, [id]: "decline" }));

    try {
      const nextTimeline = await nativeApiRef.current!.respondToApproval(id, "decline");
      setTimelineState(nextTimeline);
    } catch (error) {
      setApprovalErrors((current) => ({
        ...current,
        [id]: toErrorMessage(error, "Deny request failed.")
      }));
    } finally {
      setSubmittingApprovals((current) => omitStateKey(current, id));
    }
  };

  const handleSubmitUserInput = async (
    id: string,
    answers: Record<string, string | string[]>
  ) => {
    setUserInputErrors((current) => omitStateKey(current, id));
    setSubmittingUserInputs((current) => ({ ...current, [id]: true }));

    try {
      const nextTimeline = await nativeApiRef.current!.submitUserInput(id, answers);
      setTimelineState(nextTimeline);
    } catch (error) {
      setUserInputErrors((current) => ({
        ...current,
        [id]: toErrorMessage(error, "Submitting answers failed.")
      }));
    } finally {
      setSubmittingUserInputs((current) => omitStateKey(current, id));
    }
  };

  const appShellClassName = [
    "app-shell",
    isMacos ? "app-shell-macos" : "",
    appSettings.density === "compact" ? "app-shell-density-compact" : "",
    appSettings.reduceMotion ? "app-shell-reduced-motion" : "",
    appSettings.developerMode ? "app-shell-developer-mode" : ""
  ]
    .filter(Boolean)
    .join(" ");

  const workspaceFrameClassName = [
    "workspace-frame",
    mainView === "settings" ? "workspace-frame-settings" : "",
    mainView !== "settings" && !isRightPaneOpen ? "workspace-frame-right-pane-closed" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const visibleTranscript = appSettings.showVoiceCaptions ? liveTranscript : [];

  const handleUpdateAppSettings = async (patch: Parameters<typeof updateAppSettings>[0]) => {
    await updateAppSettings(patch);
  };

  const handleUpdateWorkerSettings = async (patch: Parameters<typeof updateWorkerSettings>[0]) => {
    await updateWorkerSettings(patch);
  };

  return (
    <div className={appShellClassName}>
      <div className="backdrop" aria-hidden="true" />
      <main className={workspaceFrameClassName}>
        <LeftRail
          appInfo={appInfo}
          workspaceState={workspaceState}
          isOpeningWorkspace={isOpeningWorkspace}
          isCreatingThread={isCreatingThread}
          archivingThreadId={archivingThreadId}
          removingWorkspaceId={removingWorkspaceId}
          runningThreadId={timelineState.isRunning ? currentThreadId : null}
          isSettingsView={mainView === "settings"}
          onOpenWorkspace={handleOpenWorkspace}
          onCreateThread={handleCreateThread}
          onRemoveWorkspace={handleRemoveWorkspace}
          onOpenSettings={handleOpenSettings}
          onSelectWorkspace={handleSelectWorkspace}
          onSelectThread={handleSelectThread}
          onArchiveThread={handleArchiveThread}
        />
        {mainView === "settings" ? (
          <SettingsPage
            appInfo={appInfo}
            appSettingsState={appSettingsState}
            isUpdatingAppSettings={isUpdatingAppSettings}
            onUpdateAppSettings={handleUpdateAppSettings}
            sessionState={sessionState}
            workspaceState={workspaceState}
            timelineState={timelineState}
            workerSettingsState={workerSettingsState}
            isUpdatingWorkerSettings={isUpdatingWorkerSettings}
            onUpdateWorkerSettings={handleUpdateWorkerSettings}
            inputDevices={inputDevices}
            outputDevices={outputDevices}
            selectedInputDeviceId={selectedInputDeviceId}
            selectedOutputDeviceId={selectedOutputDeviceId}
            supportsOutputSelection={supportsOutputSelection}
            onInputDeviceChange={setSelectedInputDeviceId}
            onOutputDeviceChange={setSelectedOutputDeviceId}
            shouldShowDeviceHint={shouldShowDeviceHint}
            onDismissDeviceHint={dismissDeviceHint}
            onResetVoicePreferences={handleResetVoicePreferences}
            archivingThreadId={archivingThreadId}
            restoringThreadId={restoringThreadId}
            archiveError={archiveError}
            onArchiveThread={handleArchiveThread}
            onUnarchiveThread={handleUnarchiveThread}
            onOpenUserDataDirectory={handleOpenUserDataDirectory}
            onClearRecentWorkspaces={handleClearRecentWorkspaces}
            onClose={handleCloseSettings}
          />
        ) : (
          <>
            <Timeline
              timelineState={timelineState}
              workspaceState={workspaceState}
              isStartingTurn={isStartingTurn}
              isOpeningWorkspace={isOpeningWorkspace}
              activePane={activePane}
              isRightPaneOpen={isRightPaneOpen}
              availableEditors={appInfo?.availableEditors ?? []}
              onStartTurn={handleStartTurn}
              onOpenWorkspace={handleOpenWorkspace}
              onToggleRightPane={() => setIsRightPaneOpen((current) => !current)}
              onOpenPane={(pane) => {
                setActivePane(pane);
                setIsRightPaneOpen(true);
              }}
              isResolvingRequests={submittingApprovalCount + submittingUserInputCount > 0}
              realtimeState={realtimeState}
              voiceState={voiceState}
              isVoiceActive={isVoiceActive}
              liveTranscript={visibleTranscript}
              workerSettingsState={workerSettingsState}
              workerAttachments={workerAttachments}
              isUpdatingWorkerSettings={isUpdatingWorkerSettings}
              isPickingAttachments={isPickingAttachments}
              submittingApprovals={submittingApprovals}
              approvalErrors={approvalErrors}
              submittingUserInputs={submittingUserInputs}
              userInputErrors={userInputErrors}
              onUpdateWorkerSettings={updateWorkerSettings}
              onPickAttachments={pickWorkerAttachments}
              onAddAttachments={addWorkerAttachments}
              onAddPastedImageAttachments={addPastedImageAttachments}
              onRemoveAttachment={removeWorkerAttachment}
              onApproveRequest={handleApproveRequest}
              onDenyRequest={handleDenyRequest}
              onSubmitUserInput={handleSubmitUserInput}
            />
            {isRightPaneOpen ? (
              <RightPane
                activePane={activePane}
                onSelect={(pane) => setActivePane(pane)}
                onClose={() => setIsRightPaneOpen(false)}
                timelineState={timelineState}
              />
            ) : null}
          </>
        )}
      </main>
      <VoiceBar
        sessionState={sessionState}
        state={voiceState}
        realtimeState={realtimeState}
        disabled={!realtimeEnabled}
        isActive={isVoiceActive}
        isStopping={isStoppingVoice}
        feedback={voiceFeedback}
        canStop={isVoiceActive || timelineState.isRunning}
        liveTranscript={visibleTranscript}
        inputDevices={inputDevices}
        outputDevices={outputDevices}
        selectedInputDeviceId={selectedInputDeviceId}
        selectedOutputDeviceId={selectedOutputDeviceId}
        supportsOutputSelection={supportsOutputSelection}
        shouldShowDeviceHint={shouldShowDeviceHint}
        onDismissDeviceHint={dismissDeviceHint}
        onInputDeviceChange={setSelectedInputDeviceId}
        onOutputDeviceChange={setSelectedOutputDeviceId}
        onToggle={() => (isVoiceActive ? stopVoice() : startVoice())}
        onStop={handleStopVoice}
      />
    </div>
  );
}
