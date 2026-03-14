import { describe, expect, it } from "vitest";
import {
  createVoiceIntentFromTranscript,
  parseRealtimeVoiceItem,
  shouldDelayVoiceIntent
} from "./voice-intents";

describe("voice-intents", () => {
  it("turns repo-work transcript into work request intent", () => {
    const parsed = createVoiceIntentFromTranscript({
      transcript: "Inspect src/App.tsx and fix the failing test",
      id: "transcript-1",
      createdAt: "10:12"
    });

    expect(parsed).toEqual(
      expect.objectContaining({
        transcriptEntry: expect.objectContaining({
          id: "transcript-1",
          text: "Inspect src/App.tsx and fix the failing test"
        }),
        intent: expect.objectContaining({
          kind: "work_request"
        })
      })
    );
    expect(parsed?.intent).toBeTruthy();
    if (!parsed?.intent) {
      throw new Error("Expected a parsed voice intent.");
    }
    expect(shouldDelayVoiceIntent(parsed.intent)).toBe(true);
  });

  it("turns stop transcript into interrupt intent", () => {
    const parsed = createVoiceIntentFromTranscript({
      transcript: "stop",
      id: "transcript-stop",
      createdAt: "10:13"
    });

    expect(parsed?.intent).toEqual(
      expect.objectContaining({
        kind: "interrupt_request"
      })
    );
  });

  it("parses handoff request items", () => {
    const parsed = parseRealtimeVoiceItem(
      {
        type: "handoff_request",
        id: "handoff-1",
        handoff_id: "handoff-real",
        input_transcript: "Inspect the auth tests",
        messages: [{ item_id: "message-1", text: "Inspect the auth tests" }]
      },
      1
    );

    expect(parsed).toEqual(
      expect.objectContaining({
        intent: expect.objectContaining({
          kind: "work_request"
        }),
        richness: 2
      })
    );
  });
});
