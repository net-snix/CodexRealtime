export const DEFAULT_SERVER_PROTOCOL = "codex-realtime.local-server.v1";
export const DEFAULT_SERVER_HOST = "127.0.0.1";
export const DEFAULT_SERVER_PORT = 0;

export interface ServerLogger {
  info(message: string, fields?: object): void;
  error(message: string, fields?: object): void;
}

export interface ServerContainer {
  appName: string;
  appVersion: string;
  clock: () => Date;
  logger: ServerLogger;
  sessionStore: Map<string, unknown>;
}

export interface CreateServerContainerOptions {
  appName?: string;
  appVersion?: string;
  clock?: () => Date;
  logger?: ServerLogger;
  sessionStore?: Map<string, unknown>;
}

export interface ServerHandshake {
  protocol: typeof DEFAULT_SERVER_PROTOCOL;
  name: string;
  version: string;
  ready: boolean;
  startedAt: string | null;
  baseUrl: string | null;
  healthUrl: string | null;
  sessionCount: number;
}

export interface CreateServerAppOptions {
  container?: ServerContainer;
  host?: string;
  port?: number;
}

export interface ServerApp {
  start(): Promise<ServerHandshake>;
  stop(): Promise<void>;
  createHandshake(): ServerHandshake;
  getContainer(): ServerContainer;
}

interface HttpRequestLike {
  method?: string;
  url?: string;
}

interface HttpResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

interface HttpServerLike {
  listen(port?: number, hostname?: string, listeningListener?: () => void): void;
  close(callback?: (error?: Error | null) => void): void;
  on(eventName: string, listener: (error: Error) => void): void;
  address(): unknown;
}

type CreateHttpServer = (
  listener: (request: HttpRequestLike, response: HttpResponseLike) => void
) => HttpServerLike;

const defaultLogger: ServerLogger = {
  info(message, fields) {
    if (fields) {
      console.info(message, fields);
      return;
    }

    console.info(message);
  },
  error(message, fields) {
    if (fields) {
      console.error(message, fields);
      return;
    }

    console.error(message);
  }
};

const importHttpModule = async () => {
  const moduleId = "node:http";
  return (await import(moduleId)) as { createServer: CreateHttpServer };
};

const toPublicHost = (host: string) => {
  if (host === "0.0.0.0" || host === "::") {
    return "127.0.0.1";
  }

  return host;
};

const toBoundPort = (address: unknown) => {
  if (
    typeof address === "object" &&
    address !== null &&
    "port" in address &&
    typeof (address as { port: unknown }).port === "number"
  ) {
    return (address as { port: number }).port;
  }

  throw new Error("Local server did not report a bound port");
};

const sendJson = (response: HttpResponseLike, statusCode: number, payload: object) => {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
};

export const createServerContainer = (
  options: CreateServerContainerOptions = {}
): ServerContainer => ({
  appName: options.appName ?? "@codex-realtime/server",
  appVersion: options.appVersion ?? "0.1.0",
  clock: options.clock ?? (() => new Date()),
  logger: options.logger ?? defaultLogger,
  sessionStore: options.sessionStore ?? new Map<string, unknown>()
});

export const createServerApp = (options: CreateServerAppOptions = {}): ServerApp => {
  const container = options.container ?? createServerContainer();
  const host = options.host ?? DEFAULT_SERVER_HOST;
  const requestedPort = options.port ?? DEFAULT_SERVER_PORT;

  let httpServer: HttpServerLike | null = null;
  let boundPort: number | null = null;
  let startedAt: string | null = null;

  const createHandshake = (): ServerHandshake => ({
    protocol: DEFAULT_SERVER_PROTOCOL,
    name: container.appName,
    version: container.appVersion,
    ready: httpServer !== null && boundPort !== null,
    startedAt,
    baseUrl: boundPort === null ? null : `http://${toPublicHost(host)}:${boundPort}`,
    healthUrl: boundPort === null ? null : `http://${toPublicHost(host)}:${boundPort}/health`,
    sessionCount: container.sessionStore.size
  });

  const handleRequest = (request: HttpRequestLike, response: HttpResponseLike) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const isHealthRequest = request.method === "GET" && (url.pathname === "/health" || url.pathname === "/ready");

    if (isHealthRequest) {
      sendJson(response, 200, createHandshake());
      return;
    }

    sendJson(response, 404, {
      error: "not_found",
      path: url.pathname
    });
  };

  const start = async () => {
    if (httpServer !== null && boundPort !== null) {
      return createHandshake();
    }

    const { createServer } = await importHttpModule();
    const server = createServer(handleRequest);

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      server.on("error", (error) => {
        if (settled) {
          return;
        }

        settled = true;
        reject(error);
      });

      server.listen(requestedPort, host, () => {
        if (settled) {
          return;
        }

        settled = true;
        resolve();
      });
    });

    httpServer = server;
    boundPort = toBoundPort(server.address());
    startedAt = container.clock().toISOString();

    const handshake = createHandshake();
    container.logger.info("Local server ready", handshake);
    return handshake;
  };

  const stop = async () => {
    if (httpServer === null) {
      return;
    }

    const server = httpServer;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    httpServer = null;
    boundPort = null;
    startedAt = null;
    container.logger.info("Local server stopped", {
      name: container.appName,
      version: container.appVersion
    });
  };

  return {
    start,
    stop,
    createHandshake,
    getContainer: () => container
  };
};
