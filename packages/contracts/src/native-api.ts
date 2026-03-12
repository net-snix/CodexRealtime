import type { ServerApi } from "./server-api.js";
import type { ShellApi } from "./shell-api.js";

export type NativeApi = ShellApi & ServerApi;
