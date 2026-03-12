import { describe, expect, it } from "vitest";
import {
  collectDescendantProcesses,
  parseElapsedSeconds,
  parseProcessSnapshotLine,
  selectStaleHelperProcesses,
  type ProcessSnapshot
} from "./codex-helper-processes";

describe("codex helper processes", () => {
  it("parses elapsed times from ps output", () => {
    expect(parseElapsedSeconds("00:45")).toBe(45);
    expect(parseElapsedSeconds("01:02:03")).toBe(3_723);
    expect(parseElapsedSeconds("08-14:05:53")).toBe(741_953);
  });

  it("parses process snapshot lines", () => {
    expect(
      parseProcessSnapshotLine(
        "  945   941  02:38 node /Users/espenmac/.codex/mcp-tools/node_modules/.bin/playwright-mcp"
      )
    ).toEqual({
      pid: 945,
      ppid: 941,
      elapsedSeconds: 158,
      command: "node /Users/espenmac/.codex/mcp-tools/node_modules/.bin/playwright-mcp"
    });
  });

  it("collects descendants recursively", () => {
    const snapshot: ProcessSnapshot[] = [
      { pid: 100, ppid: 1, elapsedSeconds: 10, command: "codex" },
      { pid: 101, ppid: 100, elapsedSeconds: 9, command: "codex app-server" },
      { pid: 102, ppid: 101, elapsedSeconds: 8, command: "node playwright-mcp" },
      { pid: 103, ppid: 102, elapsedSeconds: 7, command: "helper grandchild" }
    ];

    expect(collectDescendantProcesses(snapshot, 100)).toEqual([
      { pid: 101, ppid: 100, elapsedSeconds: 9, command: "codex app-server", depth: 1 },
      { pid: 102, ppid: 101, elapsedSeconds: 8, command: "node playwright-mcp", depth: 2 },
      { pid: 103, ppid: 102, elapsedSeconds: 7, command: "helper grandchild", depth: 3 }
    ]);
  });

  it("selects stale duplicate helpers and keeps the newest pair", () => {
    const snapshot: ProcessSnapshot[] = [
      { pid: 940, ppid: 1, elapsedSeconds: 300, command: "node codex" },
      { pid: 941, ppid: 940, elapsedSeconds: 299, command: "codex app-server" },
      {
        pid: 944,
        ppid: 941,
        elapsedSeconds: 299,
        command: "node /Users/espenmac/.codex/mcp-tools/node_modules/.bin/xcodebuildmcp mcp"
      },
      {
        pid: 945,
        ppid: 941,
        elapsedSeconds: 299,
        command: "node /Users/espenmac/.codex/mcp-tools/node_modules/.bin/playwright-mcp"
      },
      {
        pid: 1174,
        ppid: 941,
        elapsedSeconds: 55,
        command: "node /Users/espenmac/.codex/mcp-tools/node_modules/.bin/xcodebuildmcp mcp"
      },
      {
        pid: 1175,
        ppid: 941,
        elapsedSeconds: 55,
        command: "node /Users/espenmac/.codex/mcp-tools/node_modules/.bin/playwright-mcp"
      },
      {
        pid: 1464,
        ppid: 941,
        elapsedSeconds: 6,
        command: "node /Users/espenmac/.codex/mcp-tools/node_modules/.bin/xcodebuildmcp mcp"
      },
      {
        pid: 1465,
        ppid: 941,
        elapsedSeconds: 6,
        command: "node /Users/espenmac/.codex/mcp-tools/node_modules/.bin/playwright-mcp"
      }
    ];

    const selection = selectStaleHelperProcesses(snapshot, 940, {
      minimumAgeSeconds: 45
    });

    expect(selection.found).toBe(6);
    expect(selection.stale.map((process) => process.pid).sort((left, right) => left - right)).toEqual([
      944,
      945,
      1174,
      1175
    ]);
  });
});
