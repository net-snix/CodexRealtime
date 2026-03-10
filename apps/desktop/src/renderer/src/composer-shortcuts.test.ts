import { describe, expect, it } from "vitest";
import { shouldSubmitComposerKey } from "./composer-shortcuts";

describe("shouldSubmitComposerKey", () => {
  it("submits on plain enter", () => {
    expect(
      shouldSubmitComposerKey({
        key: "Enter",
        shiftKey: false
      })
    ).toBe(true);
  });

  it("keeps shift-enter for newlines", () => {
    expect(
      shouldSubmitComposerKey({
        key: "Enter",
        shiftKey: true
      })
    ).toBe(false);
  });

  it("does not submit while IME composition is active", () => {
    expect(
      shouldSubmitComposerKey({
        key: "Enter",
        shiftKey: false,
        nativeEvent: { isComposing: true }
      })
    ).toBe(false);
  });
});
