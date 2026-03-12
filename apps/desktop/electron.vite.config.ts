import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const fromRoot = (...segments: string[]) => resolve(__dirname, ...segments);
const contractsAliases = {
  "@codex-realtime/contracts": fromRoot("../../packages/contracts/src/index.ts"),
  "@codex-realtime/contracts/ipc": fromRoot("../../packages/contracts/src/ipc.ts"),
  "@codex-realtime/contracts/server-api": fromRoot("../../packages/contracts/src/server-api.ts"),
  "@codex-realtime/contracts/shell-api": fromRoot("../../packages/contracts/src/shell-api.ts"),
};

export default defineConfig({
  main: {
    resolve: {
      alias: {
        ...contractsAliases,
        "@shared": fromRoot("../../packages/shared/src"),
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    resolve: {
      alias: {
        ...contractsAliases,
        "@shared": fromRoot("../../packages/shared/src"),
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        ...contractsAliases,
        "@renderer": fromRoot("src/renderer/src"),
        "@shared": fromRoot("../../packages/shared/src"),
      },
    },
    plugins: [react()],
  },
});
