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

export default function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>({
    currentWorkspace: null,
    recentWorkspaces: [],
    threads: []
  });
  const [timelineState, setTimelineState] = useState<TimelineState>({
    threadId: null,
    events: [],
    isRunning: false,
    statusLabel: null
  });
  const [isOpeningWorkspace, setIsOpeningWorkspace] = useState(false);
  const [isStartingTurn, setIsStartingTurn] = useState(false);
  const [activePane, setActivePane] = useState<PaneKey>("plan");

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
          threadId: null,
          events: [],
          isRunning: false,
          statusLabel: "timeline unavailable"
        });
      }
    });
  }, []);

  const handleOpenWorkspace = async () => {
    setIsOpeningWorkspace(true);

    try {
      const nextState = await window.appBridge.openWorkspace();
      setWorkspaceState(nextState);
      const nextTimeline = await window.appBridge.getTimelineState();
      setTimelineState(nextTimeline);
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
        <RightPane activePane={activePane} onSelect={setActivePane} />
      </main>
      <VoiceBar sessionState={sessionState} state={initialVoiceState} />
    </div>
  );
}
