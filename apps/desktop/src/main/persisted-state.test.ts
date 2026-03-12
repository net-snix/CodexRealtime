import { describe, expect, it } from "vitest";

import { readPersistedState } from "./persisted-state";

describe("readPersistedState", () => {
  it("returns defaults when persisted JSON is malformed", () => {
    const defaults = {
      enabled: false
    };
    const validators = {
      enabled: (value: unknown): value is boolean => typeof value === "boolean"
    };

    const state = readPersistedState("{", defaults, validators);

    expect(state).toEqual(defaults);
  });

  it("hydrates only validated own fields", () => {
    const defaults = {
      enabled: false,
      label: ""
    };
    const validators = {
      enabled: (value: unknown): value is boolean => typeof value === "boolean",
      label: (value: unknown): value is string => typeof value === "string"
    };

    const state = readPersistedState(
      JSON.stringify({
        enabled: true,
        label: "ok"
      }),
      defaults,
      validators
    );

    expect(state).toEqual({
      enabled: true,
      label: "ok"
    });
  });
});
