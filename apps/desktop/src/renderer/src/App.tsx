import { useEffect, useState } from "react";
import type {
  AppInfo,
  SessionState,
  TimelineState,
  VoiceState,
  WorkspaceState
} from "@shared";
import { LeftRail } from "./components/LeftRail";
import { RightPane } from "./components/RightPane";
import { Timeline } from "./components/Timeline";
import { VoiceBar } from "./components/VoiceBar";

const initialVoiceState: VoiceState = "idle";

type PaneKey = "plan" | "diff" | "commands" | "approvals" | "errors";

type LivePlanStep = {
  step: string;
  status: string;
};

type LiveApproval = {
  id: string;
  kind: "command" | "fileChange";
  title: string;
  detail: string;
};

type LiveUserInput = {
  id: string;
  title: string;
  questions: string[];
};

type LiveTimelineState = TimelineState & {
  planSteps?: LivePlanStep[];
  diff?: string;
  approvals?: LiveApproval[];
  userInputs?: LiveUserInput[];
};

const emptyTimelineState: LiveTimelineState = {
  threadId: null,
  events: [],
  isRunning: false,
  statusLabel: null,
  planSteps: [],
  diff: "",
  approvals: [],
  userInputs: []
};

const normalizeTimelineState = (timelineState: TimelineState): LiveTimelineState => ({
  ...timelineState,
  planSteps: "planSteps" in timelineState && Array.isArray(timelineState.planSteps)
    ? timelineState.planSteps
    : [],
  diff: "diff" in timelineState && typeof timelineState.diff === "string" ? timelineState.diff : "",
  approvals: "approvals" in timelineState && Array.isArray(timelineState.approvals)
    ? timelineState.approvals
    : [],
  userInputs: "userInputs" in timelineState && Array.isArray(timelineState.userInputs)
    ? timelineState.userInputs
    : []
});

export default function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>({
    currentWorkspace: null,
    recentWorkspaces: [],
    threads: []
  });
  const [timelineState, setTimelineState] = useState<LiveTimelineState>(emptyTimelineState);
  const [isOpeningWorkspace, setIsOpeningWorkspace] = useState(false);
  const [isStartingTurn, setIsStartingTurn] = useState(false);
  const [activePane, setActivePane] = useState<PaneKey>("plan");
  const approvalCount = timelineState.approvals?.length ?? 0;
  const userInputCount = timelineState.userInputs?.length ?? 0;
  const isTimelinePolling = timelineState.isRunning || approvalCount > 0 || userInputCount > 0;

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
        setTimelineState(normalizeTimelineState(timelineResult.value));
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
        setTimelineState(normalizeTimelineState(nextTimeline));
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
      const nextTimeline = await window.appBridge.getTimelineState();
      setTimelineState(normalizeTimelineState(nextTimeline));
    } finally {
      setIsOpeningWorkspace(false);
    }
  };

  const handleStartTurn = async (prompt: string) => {
    setIsStartingTurn(true);

    try {
      const nextTimeline = await window.appBridge.startTurn(prompt);
      setTimelineState(normalizeTimelineState(nextTimeline));
      const nextWorkspaceState = await window.appBridge.getWorkspaceState();
      setWorkspaceState(nextWorkspaceState);
    } finally {
      setIsStartingTurn(false);
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
        />
        <RightPane
          activePane={activePane}
          onSelect={setActivePane}
          timelineState={timelineState}
        />
      </main>
      <VoiceBar sessionState={sessionState} state={initialVoiceState} />
    </div>
  );
}
