const MAX_SERVER_PORT = 65_535;
const PORT_PATTERN = /^\d+$/;

export const parseServerPort = (rawPort: string | undefined) => {
  if (!rawPort) {
    return 0;
  }

  if (!PORT_PATTERN.test(rawPort)) {
    throw new Error(`Invalid CODEX_REALTIME_SERVER_PORT: ${rawPort}`);
  }

  const parsedPort = Number(rawPort);

  if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > MAX_SERVER_PORT) {
    throw new Error(`Invalid CODEX_REALTIME_SERVER_PORT: ${rawPort}`);
  }

  return parsedPort;
};
