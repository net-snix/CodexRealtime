import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type ValidatorMap<T extends object> = {
  [K in keyof T]?: (value: unknown) => value is T[K];
};

export const DEFAULT_MAX_PERSISTED_STATE_BYTES = 64 * 1024;

type PersistedStateReadOptions = {
  maxBytes?: number;
};

const cloneDefaults = <T extends object>(defaults: T): T => ({
  ...defaults
});

export const readPersistedState = <T extends object>(
  raw: string,
  defaults: T,
  validators: ValidatorMap<T>,
  options: PersistedStateReadOptions = {}
): T => {
  const nextState = cloneDefaults(defaults);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_PERSISTED_STATE_BYTES;

  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    return nextState;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return nextState;
  }

  if (!isRecord(parsed)) {
    return nextState;
  }

  for (const [key, validator] of Object.entries(validators) as [keyof T, ValidatorMap<T>[keyof T]][]) {
    const stringKey = String(key);
    if (!Object.hasOwn(parsed, stringKey)) {
      continue;
    }

    const parsedValue = parsed[stringKey];
    if (!validator || !validator(parsedValue)) {
      continue;
    }

    nextState[key] = parsedValue;
  }

  return nextState;
};

export const readPersistedStateFile = <T extends object>(
  filePath: string,
  defaults: T,
  validators: ValidatorMap<T>,
  options: PersistedStateReadOptions = {}
): T => {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_PERSISTED_STATE_BYTES;

  try {
    if (statSync(filePath).size > maxBytes) {
      return cloneDefaults(defaults);
    }

    return readPersistedState(readFileSync(filePath, "utf8"), defaults, validators, options);
  } catch {
    return cloneDefaults(defaults);
  }
};

export const writePersistedStateFile = (filePath: string, state: object) => {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
};
