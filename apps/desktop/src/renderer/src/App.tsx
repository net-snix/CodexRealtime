import { useEffect, useState } from "react";
import type {
  ApprovalDecision,
  AppInfo,
  SessionState,
  TimelineState,
  WorkspaceState
} from "@shared";
import { LeftRail } from "./components/LeftRail";
import { RightPane } from "./components/RightPane";
import { Timeline } from "./components/Timeline";
import { useRealtimeVoice } from "./use-realtime-voice";
import { VoiceBar } from "./components/VoiceBar";

type PaneKey = "plan" | "diff" | "commands" | "approvals" | "errors";

const emptyTimelineState: TimelineState = {
  threadId: null,
  events: [],
  isRunning: false,
  statusLabel: null,
  planSteps: [],
  diff: "",
  approvals: [],
  userInputs: []
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

export default function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>({
    currentWorkspace: null,
    recentWorkspaces: [],
    threads: []
  });
  const [timelineState, setTimelineState] = useState<TimelineState>(emptyTimelineState);
  const [isOpeningWorkspace, setIsOpeningWorkspace] = useState(false);
  const [isStartingTurn, setIsStartingTurn] = useState(false);
  const [isStoppingVoice, setIsStoppingVoice] = useState(false);
  const [activePane, setActivePane] = useState<PaneKey>("plan");
  const [submittingApprovals, setSubmittingApprovals] = useState<Record<string, ApprovalDecision>>({});
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string>>({});
  const [submittingUserInputs, setSubmittingUserInputs] = useState<Record<string, boolean>>({});
  const [userInputErrors, setUserInputErrors] = useState<Record<string, string>>({});
  const realtimeEnabled = Boolean(
    sessionState?.status === "connected" &&
      sessionState.features.realtimeConversation &&
      workspaceState.currentWorkspace
  );
  const {
    voiceState,
    realtimeState,
    liveTranscript,
    isActive: isVoiceActive,
    start: startVoice,
    stop: stopVoice
  } =
    useRealtimeVoice({
      enabled: realtimeEnabled,
      onVoicePrompt: async (prompt) => {
        try {
          const nextTimeline = await window.appBridge.dispatchVoicePrompt(prompt);
          setTimelineState(nextTimeline);
        } catch (error) {
          console.error("Voice prompt dispatch failed", error);
        }
      }
    });
  const approvalCount = timelineState.approvals?.length ?? 0;
  const userInputCount = timelineState.userInputs?.length ?? 0;
  const submittingApprovalCount = Object.keys(submittingApprovals).length;
  const submittingUserInputCount = Object.keys(submittingUserInputs).length;
  const isTimelinePolling =
    timelineState.isRunning ||
    approvalCount > 0 ||
    userInputCount > 0 ||
    submittingApprovalCount > 0 ||
    submittingUserInputCount > 0;

  const refreshTimelineState = async () => {
    const nextTimeline = await window.appBridge.getTimelineState();
    setTimelineState(nextTimeline);
  };

  useEffect(() => {
    void Promise.allSettled([
      window.appBridge.getAppInfo(),
      window.appBridge.getSessionState(),
      window.appBridge.getWorkspaceState(),
      window.appBridge.getTimelineState()
    ]).then(([appInfoResult, sessionResult, workspaceResult, timelineResult]) => {
      if (appInfoResult.status === "fulfilled") {
        setAppInfo(appInfoResult.value);
      } else {
        setAppInfo({
          name: "Codex Realtime",
          version: "0.1.0",
          platform: "darwin"
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
          statusLabel: "timeline unavailable"
        });
      }
    });
  }, []);

  useEffect(() => {
    if (!isTimelinePolling) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void window.appBridge.getTimelineState().then((nextTimeline) => {
        setTimelineState(nextTimeline);
      });
    }, 900);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [approvalCount, isTimelinePolling, timelineState.threadId, userInputCount]);

  const handleOpenWorkspace = async () => {
    setIsOpeningWorkspace(true);

    try {
      const nextState = await window.appBridge.openWorkspace();
      setWorkspaceState(nextState);
      await refreshTimelineState();
    } finally {
      setIsOpeningWorkspace(false);
    }
  };

  const handleStartTurn = async (prompt: string) => {
    setIsStartingTurn(true);

    try {
      const nextTimeline = await window.appBridge.startTurn(prompt);
      setTimelineState(nextTimeline);
      const nextWorkspaceState = await window.appBridge.getWorkspaceState();
      setWorkspaceState(nextWorkspaceState);
    } finally {
      setIsStartingTurn(false);
    }
  };

  const handleStopVoice = async () => {
    setIsStoppingVoice(true);

    try {
      if (timelineState.isRunning) {
        const nextTimeline = await window.appBridge.interruptActiveTurn();
        setTimelineState(nextTimeline);
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
    const activeApprovalIds = new Set((timelineState.approvals ?? []).map((approval) => approval.id));
    const activeUserInputIds = new Set((timelineState.userInputs ?? []).map((prompt) => prompt.id));

    setSubmittingApprovals((current) => filterStateMap(current, activeApprovalIds));
    setApprovalErrors((current) => filterStateMap(current, activeApprovalIds));
    setSubmittingUserInputs((current) => filterStateMap(current, activeUserInputIds));
    setUserInputErrors((current) => filterStateMap(current, activeUserInputIds));
  }, [timelineState.approvals, timelineState.userInputs]);

  const handleApproveRequest = async (id: string, decision: ApprovalDecision = "accept") => {
    setApprovalErrors((current) => omitStateKey(current, id));
    setSubmittingApprovals((current) => ({ ...current, [id]: decision }));

    try {
      await window.appBridge.respondToApproval(id, decision);
      await refreshTimelineState();
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
      await window.appBridge.respondToApproval(id, "decline");
      await refreshTimelineState();
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
      await window.appBridge.submitUserInput(id, answers);
      await refreshTimelineState();
    } catch (error) {
      setUserInputErrors((current) => ({
        ...current,
        [id]: toErrorMessage(error, "Submitting answers failed.")
      }));
    } finally {
      setSubmittingUserInputs((current) => omitStateKey(current, id));
    }
  };

  return (
    <div className="app-shell">
      <div className="backdrop" aria-hidden="true" />
      <main className="workspace-frame">
        <LeftRail
          appInfo={appInfo}
          sessionState={sessionState}
          workspaceState={workspaceState}
          isOpeningWorkspace={isOpeningWorkspace}
          onOpenWorkspace={handleOpenWorkspace}
        />
        <Timeline
          timelineState={timelineState}
          workspaceState={workspaceState}
          isStartingTurn={isStartingTurn}
          onStartTurn={handleStartTurn}
          isResolvingRequests={submittingApprovalCount + submittingUserInputCount > 0}
          realtimeState={realtimeState}
          voiceState={voiceState}
          isVoiceActive={isVoiceActive}
          liveTranscript={liveTranscript}
        />
        <RightPane
          activePane={activePane}
          onSelect={setActivePane}
          timelineState={timelineState}
          submittingApprovals={submittingApprovals}
          approvalErrors={approvalErrors}
          submittingUserInputs={submittingUserInputs}
          userInputErrors={userInputErrors}
          onApproveRequest={handleApproveRequest}
          onDenyRequest={handleDenyRequest}
          onSubmitUserInput={handleSubmitUserInput}
        />
      </main>
      <VoiceBar
        sessionState={sessionState}
        state={voiceState}
        realtimeState={realtimeState}
        disabled={!realtimeEnabled}
        isActive={isVoiceActive}
        isStopping={isStoppingVoice}
        canStop={isVoiceActive || timelineState.isRunning}
        liveTranscript={liveTranscript}
        onToggle={() => (isVoiceActive ? stopVoice() : startVoice())}
        onStop={handleStopVoice}
      />
    </div>
  );
}
