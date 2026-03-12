const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type ValidatorMap<T extends object> = {
  [K in keyof T]?: (value: unknown) => value is T[K];
};

export const readPersistedState = <T extends object>(
  raw: string,
  defaults: T,
  validators: ValidatorMap<T>
): T => {
  const nextState: T = {
    ...defaults
  };

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
