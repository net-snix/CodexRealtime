import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const fromRoot = (...segments: string[]) => resolve(__dirname, ...segments);

export default defineConfig({
  resolve: {
    alias: {
      "@codex-realtime/contracts": fromRoot("../../packages/contracts/src/index.ts"),
      "@codex-realtime/contracts/ipc": fromRoot("../../packages/contracts/src/ipc.ts"),
      "@codex-realtime/contracts/server-api": fromRoot("../../packages/contracts/src/server-api.ts"),
      "@codex-realtime/contracts/shell-api": fromRoot("../../packages/contracts/src/shell-api.ts"),
      "@codex-realtime/shared/structured-log": fromRoot(
        "../../packages/shared/src/structured-log.ts"
      ),
      "@renderer": fromRoot("src/renderer/src"),
      "@shared": fromRoot("../../packages/shared/src/index.ts")
    }
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["e2e/**"]
  }
});
