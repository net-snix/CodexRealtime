import { describe, expect, it } from "vitest";
import {
  normalizeProviderRuntimeNotification,
  normalizeProviderRuntimeRequest
} from "@codex-realtime/contracts";
import {
  normalizeBridgeNotification,
  normalizeBridgeRequest,
  projectTurnRecord
} from "./timeline-runtime-events";

describe("projectTurnRecord", () => {
  it("normalizes camelCase runtime items into canonical timeline entries", () => {
    const projected = projectTurnRecord(
      {
        id: "turn-1",
        startedAt: "2026-03-11T10:00:00.000Z",
        completedAt: "2026-03-11T10:01:00.000Z",
        items: [
          {
            type: "agentMessage",
            id: "assistant-1",
            createdAt: "2026-03-11T10:00:02.000Z",
            completedAt: "2026-03-11T10:00:10.000Z",
            providerLabel: "gpt-5.4",
            text: "Hello"
          },
          {
            type: "collabAgentToolCall",
            id: "agent-1",
            createdAt: "2026-03-11T10:00:11.000Z",
            agentLabel: "Diff agent",
            label: "Delegated patch review",
            detail: "Reviewing changes"
          },
          {
            type: "fileChange",
            id: "diff-1",
            createdAt: "2026-03-11T10:00:12.000Z",
            changes: [
              {
                path: "src/app.ts",
                diff: "@@ -1 +1 @@\n-old\n+new"
              }
            ]
          }
        ]
      },
      0
    );

    expect(projected.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "assistant-1",
          kind: "message",
          providerLabel: "gpt-5.4",
          completedAt: "2026-03-11T10:00:10.000Z"
        }),
        expect.objectContaining({
          id: "agent-1",
          kind: "activity",
          activityType: "collab_agent_tool_call",
          agentLabel: "Diff agent",
          label: "Delegated patch review"
        })
      ])
    );
    expect(projected.diffEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "diff-1",
          kind: "diffSummary",
          assistantMessageId: "assistant-1",
          files: [
            expect.objectContaining({
              path: "src/app.ts",
              additions: 1,
              deletions: 1
            })
          ]
        })
      ])
    );
  });
});

describe("normalizeBridgeNotification", () => {
  it("accepts dot-style plan events and emits active plan plus activity mutations", () => {
    const result = normalizeBridgeNotification({
      method: "turn.plan.updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        createdAt: "2026-03-11T10:00:00.000Z",
        explanation: "Ship the plan",
        plan: [{ step: "Ship it", status: "pending" }]
      }
    });

    expect(result.threadId).toBe("thread-1");
    expect(result.mutations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "setActivePlan",
          plan: expect.objectContaining({
            turnId: "turn-1",
            text: "Ship the plan"
          })
        }),
        expect.objectContaining({
          type: "upsertEntry",
          entry: expect.objectContaining({
            kind: "activity",
            activityType: "plan_update",
            label: "Plan updated"
          })
        })
      ])
    );
  });

  it("maps proposed-plan deltas and request.opened notifications", () => {
    const proposed = normalizeBridgeNotification({
      method: "turn.proposed.delta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        createdAt: "2026-03-11T10:00:00.000Z",
        delta: "1. Tighten spacing"
      }
    });
    const openedRequest = normalizeBridgeNotification({
      method: "request.opened",
      params: {
        threadId: "thread-1",
        requestId: "req-1",
        requestType: "file_read_approval",
        reason: "Need to inspect a config",
        path: "/tmp/config.json"
      }
    });

    expect(proposed.mutations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "upsertLatestProposedPlan",
          merge: "append",
          plan: expect.objectContaining({
            turnId: "turn-1",
            text: "1. Tighten spacing"
          })
        })
      ])
    );
    expect(openedRequest.mutations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "upsertApproval",
          approval: expect.objectContaining({
            id: "req-1",
            title: "Read file",
            kind: "fileChange"
          })
        })
      ])
    );
  });
});

describe("normalizeBridgeRequest", () => {
  it("maps approval and user-input request methods onto canonical mutations", () => {
    const approval = normalizeBridgeRequest({
      id: "req-1",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thread-1",
        command: "pnpm build",
        cwd: "/tmp/work"
      }
    });
    const userInput = normalizeBridgeRequest({
      id: "req-2",
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thread-1",
        questions: [
          {
            id: "clarify",
            header: "Clarify",
            question: "Pick one",
            options: [{ label: "A", description: "Option A" }]
          }
        ]
      }
    });

    expect(approval.mutations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "upsertApproval",
          approval: expect.objectContaining({
            id: "req-1",
            title: "Run command: pnpm build",
            kind: "command"
          })
        })
      ])
    );
    expect(userInput.mutations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "upsertUserInput",
          request: expect.objectContaining({
            id: "req-2",
            title: "Clarification requested"
          })
        })
      ])
    );
  });
});

describe("provider runtime contracts", () => {
  it("canonicalizes approval requests with replay metadata", () => {
    const event = normalizeProviderRuntimeRequest({
      id: "req-1",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thread-1",
        commandId: "cmd-1",
        sourceEventId: "evt-1",
        sourceSeq: 17,
        command: "pnpm build",
        cwd: "/tmp/work"
      }
    });

    expect(event).toEqual(
      expect.objectContaining({
        kind: "approval.requested",
        threadId: "thread-1",
        commandId: "cmd-1",
        sourceEventId: "evt-1",
        sourceSeq: 17,
        requestId: "req-1",
        requestType: "command_execution_approval",
        command: "pnpm build",
        cwd: "/tmp/work"
      })
    );
  });

  it("canonicalizes tool notifications before timeline normalization", () => {
    const event = normalizeProviderRuntimeNotification({
      method: "tool.progress",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "tool-1",
        createdAt: "2026-03-11T10:00:00.000Z",
        sourceSeq: 23,
        toolName: "read_file",
        status: "running",
        message: "Scanning workspace"
      }
    });

    expect(event).toEqual(
      expect.objectContaining({
        kind: "tool.call",
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "tool-1",
        toolName: "read_file",
        status: "in_progress",
        sourceSeq: 23
      })
    );
  });
});
