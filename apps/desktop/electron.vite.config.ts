import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const fromRoot = (...segments: string[]) => resolve(__dirname, ...segments);

export default defineConfig({
  main: {
    resolve: {
      alias: {
        "@shared": fromRoot("../../packages/shared/src"),
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    resolve: {
      alias: {
        "@shared": fromRoot("../../packages/shared/src"),
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": fromRoot("src/renderer/src"),
        "@shared": fromRoot("../../packages/shared/src"),
      },
    },
    plugins: [react()],
  },
});
