import { describe, expect, it } from "vitest";
import { isThreadNotMaterializedError } from "./thread-materialization";

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
