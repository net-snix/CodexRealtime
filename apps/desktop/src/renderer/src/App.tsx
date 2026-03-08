import { useEffect, useState } from "react";
import type {
  AppInfo,
  SessionState,
  TimelineEvent,
  VoiceState,
  WorkspaceState
} from "@shared";
import { LeftRail } from "./components/LeftRail";
import { RightPane } from "./components/RightPane";
import { Timeline } from "./components/Timeline";
import { VoiceBar } from "./components/VoiceBar";

const mockEvents: TimelineEvent[] = [
  {
    id: "event-user-1",
    kind: "user",
    text: "Build the shell first. Keep it visible. Keep it calm.",
    createdAt: "Now",
  },
  {
    id: "event-assistant-1",
    kind: "assistant",
    text: "Phase 1 only. Static UI. No Codex, no mic, no false promises.",
    createdAt: "Now",
  },
  {
    id: "event-system-1",
    kind: "system",
    text: "App server, approvals, and voice transport arrive in later slices.",
    createdAt: "Commit 1",
  },
];

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
  const [isOpeningWorkspace, setIsOpeningWorkspace] = useState(false);
  const [activePane, setActivePane] = useState<PaneKey>("plan");

  useEffect(() => {
    void Promise.allSettled([
      window.appBridge.getAppInfo(),
      window.appBridge.getSessionState(),
      window.appBridge.getWorkspaceState()
    ]).then(([appInfoResult, sessionResult, workspaceResult]) => {
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
    });
  }, []);

  const handleOpenWorkspace = async () => {
    setIsOpeningWorkspace(true);

    try {
      const nextState = await window.appBridge.openWorkspace();
      setWorkspaceState(nextState);
    } finally {
      setIsOpeningWorkspace(false);
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
        <Timeline events={mockEvents} />
        <RightPane activePane={activePane} onSelect={setActivePane} />
      </main>
      <VoiceBar sessionState={sessionState} state={initialVoiceState} />
    </div>
  );
}
