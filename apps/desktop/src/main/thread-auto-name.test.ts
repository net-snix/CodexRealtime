import { describe, expect, it } from "vitest";
import { buildAutoThreadName, normalizeAutoThreadName } from "./thread-auto-name";

describe("thread-auto-name", () => {
  it("normalizes concise thread names", () => {
    expect(normalizeAutoThreadName("  Fix thread naming flow.  ")).toBe("Fix thread naming flow");
    expect(normalizeAutoThreadName("New thread")).toBeNull();
    expect(normalizeAutoThreadName("   ")).toBeNull();
  });

  it("keeps names short without chopping too aggressively", () => {
    expect(
      normalizeAutoThreadName(
        "Build concise automatic thread naming for new chats using Codex summaries"
      )
    ).toBe("Build concise automatic thread naming for new");
  });

  it("falls back to the opening prompt when no summary exists", () => {
    expect(buildAutoThreadName(null, "Wire settings toggle for auto thread names")).toBe(
      "Wire settings toggle for auto thread names"
    );
  });
});
