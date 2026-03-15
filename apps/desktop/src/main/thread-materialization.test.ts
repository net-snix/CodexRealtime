import { describe, expect, it } from "vitest";
import {
  isThreadNotFoundError,
  isThreadNotMaterializedError,
  isThreadUnavailableForArchiveError
} from "./thread-materialization";

describe("isThreadNotMaterializedError", () => {
  it("matches the app-server thread materialization error", () => {
    expect(
      isThreadNotMaterializedError(
        new Error(
          "thread 123 is not materialized yet; includeTurns is unavailable before first user message"
        )
      )
    ).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isThreadNotMaterializedError(new Error("connection dropped"))).toBe(false);
  });
});

describe("isThreadNotFoundError", () => {
  it("matches thread id not found variations", () => {
    expect(isThreadNotFoundError(new Error("no outline found for thread id abc"))).toBe(true);
    expect(isThreadNotFoundError(new Error("Thread abc was not found"))).toBe(true);
    expect(isThreadNotFoundError(new Error("conversation xyz does not exist"))).toBe(true);
    expect(isThreadNotFoundError(new Error("no rollout found for thread id abc"))).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isThreadNotFoundError(new Error("failed to save draft"))).toBe(false);
  });
});

describe("isThreadUnavailableForArchiveError", () => {
  it("matches materialized and not found thread errors", () => {
    expect(
      isThreadUnavailableForArchiveError(
        new Error(
          "thread 123 is not materialized yet; includeTurns is unavailable before first user message"
        )
      )
    ).toBe(true);
    expect(isThreadUnavailableForArchiveError(new Error("no outline found for thread id abc"))).toBe(
      true
    );
  });

  it("does not match unrelated errors", () => {
    expect(isThreadUnavailableForArchiveError(new Error("connection dropped"))).toBe(false);
  });
});
