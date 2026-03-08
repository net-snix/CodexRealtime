import { useEffect, useState } from "react";
import type { AppInfo, ThreadSummary, TimelineEvent, VoiceState, WorkspaceSummary } from "@shared";
import { LeftRail } from "./components/LeftRail";
import { RightPane } from "./components/RightPane";
import { Timeline } from "./components/Timeline";
import { VoiceBar } from "./components/VoiceBar";

const mockWorkspaces: WorkspaceSummary[] = [
  {
    id: "wksp-codex-realtime",
    name: "CodexRealtime",
    path: "~/Code/CodexRealtime",
  },
  {
    id: "wksp-oracle",
    name: "oracle",
    path: "~/Code/oss/oracle",
  },
];

const mockThreads: ThreadSummary[] = [
  {
    id: "thread-primary",
    title: "Voice-native SWE MVP",
    updatedAt: "Last active now",
  },
  {
    id: "thread-empty",
    title: "Fresh start",
    updatedAt: "Ready when needed",
  },
];

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
  const [activePane, setActivePane] = useState<PaneKey>("plan");

  useEffect(() => {
    void window.appBridge
      .getAppInfo()
      .then(setAppInfo)
      .catch(() => {
        setAppInfo({
          name: "Codex Realtime",
          version: "0.1.0",
          platform: "darwin",
        });
      });
  }, []);

  return (
    <div className="app-shell">
      <div className="backdrop" aria-hidden="true" />
      <main className="workspace-frame">
        <LeftRail appInfo={appInfo} workspaces={mockWorkspaces} threads={mockThreads} />
        <Timeline events={mockEvents} />
        <RightPane activePane={activePane} onSelect={setActivePane} />
      </main>
      <VoiceBar state={initialVoiceState} />
    </div>
  );
}
