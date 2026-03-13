import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveAvailableEditors,
  resolveEditorLaunch
} from "./editor-launch";

const tempDirs: string[] = [];

const createExecutable = (dir: string, name: string) => {
  const filePath = join(dir, name);
  writeFileSync(filePath, "#!/bin/sh\nexit 0\n");
  chmodSync(filePath, 0o755);
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("editor-launch", () => {
  it("uses --goto for editor links with line and column", () => {
    expect(resolveEditorLaunch("/tmp/workspace/src/App.tsx:71:5", "vscode", "darwin")).toEqual({
      command: "code",
      args: ["--goto", "/tmp/workspace/src/App.tsx:71:5"]
    });
  });

  it("strips line and column suffixes for file manager targets", () => {
    expect(resolveEditorLaunch("/tmp/workspace/src/App.tsx:71:5", "file-manager", "darwin")).toEqual({
      command: "open",
      args: ["/tmp/workspace/src/App.tsx"]
    });
  });

  it("filters editors to commands found on PATH", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-realtime-editors-"));
    tempDirs.push(dir);
    createExecutable(dir, "code");
    createExecutable(dir, "open");

    expect(resolveAvailableEditors("darwin", { PATH: dir })).toEqual(["vscode", "file-manager"]);
  });
});
