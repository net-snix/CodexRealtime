import { describe, expect, it } from "vitest";
import {
  buildWorkerInputs,
  resolveWorkerSettings,
  supportsImageAttachments,
  workerSettingsFromConfig
} from "./worker-settings";

describe("worker-settings", () => {
  it("keeps selected settings aligned to the chosen model", () => {
    const resolved = resolveWorkerSettings(
      {
        model: "gpt-5.1-codex-mini",
        reasoningEffort: "xhigh",
        fastMode: true,
        approvalPolicy: "on-request"
      },
      [
        {
          id: "gpt-5.1-codex-mini",
          model: "gpt-5.1-codex-mini",
          label: "GPT-5.1-Codex-Mini",
          description: "",
          isDefault: false,
          supportsImageInput: true,
          supportedReasoningEfforts: ["medium", "high"],
          defaultReasoningEffort: "medium"
        }
      ]
    );

    expect(resolved.reasoningEffort).toBe("medium");
    expect(resolved.fastMode).toBe(true);
    expect(resolved.approvalPolicy).toBe("on-request");
  });

  it("converts image attachments only when the model supports image input", () => {
    const attachments = [
      {
        id: "/tmp/design.png",
        name: "design.png",
        path: "/tmp/design.png",
        kind: "image" as const
      },
      {
        id: "/tmp/spec.md",
        name: "spec.md",
        path: "/tmp/spec.md",
        kind: "file" as const
      }
    ];

    expect(supportsImageAttachments("vision-model", [
      {
        id: "vision-model",
        model: "vision-model",
        label: "Vision",
        description: "",
        isDefault: true,
        supportsImageInput: true,
        supportedReasoningEfforts: ["high"],
        defaultReasoningEffort: "high"
      }
    ])).toBe(true);

    expect(buildWorkerInputs("fix this", attachments, true)).toEqual([
      { type: "localImage", path: "/tmp/design.png" },
      { type: "mention", name: "spec.md", path: "/tmp/spec.md" },
      { type: "text", text: "fix this", text_elements: [] }
    ]);

    expect(buildWorkerInputs("fix this", attachments, false)).toEqual([
      { type: "mention", name: "design.png", path: "/tmp/design.png" },
      { type: "mention", name: "spec.md", path: "/tmp/spec.md" },
      { type: "text", text: "fix this", text_elements: [] }
    ]);
  });

  it("maps codex config defaults into worker settings", () => {
    expect(
      workerSettingsFromConfig({
        model: "gpt-5.4",
        model_reasoning_effort: "xhigh",
        approval_policy: "never",
        service_tier: "fast"
      })
    ).toEqual({
      model: "gpt-5.4",
      reasoningEffort: "xhigh",
      approvalPolicy: "never",
      fastMode: true
    });
  });
});
