export const IPC_CHANNELS = {
  appGetInfo: "app:get-info",
  sessionGetState: "session:get-state",
  workspaceGetState: "workspace:get-state",
  workspaceOpen: "workspace:open",
  timelineGetState: "timeline:get-state",
  turnStart: "turn:start",
  approvalRespond: "approval:respond",
  userInputSubmit: "user-input:submit",
} as const;
