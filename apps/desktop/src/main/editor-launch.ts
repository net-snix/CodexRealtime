import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { extname, join } from "node:path";
import { EDITORS, type EditorId } from "@codex-realtime/contracts";

type EditorLaunch = {
  command: string;
  args: string[];
};

const LINE_COLUMN_SUFFIX_PATTERN = /:\d+(?::\d+)?$/;

const shouldUseGotoFlag = (editorId: EditorId, targetPath: string) =>
  (editorId === "cursor" || editorId === "vscode") && LINE_COLUMN_SUFFIX_PATTERN.test(targetPath);

const stripLineColumnSuffix = (targetPath: string) =>
  LINE_COLUMN_SUFFIX_PATTERN.test(targetPath)
    ? targetPath.replace(LINE_COLUMN_SUFFIX_PATTERN, "")
    : targetPath;

const fileManagerCommandForPlatform = (platform: NodeJS.Platform) => {
  switch (platform) {
    case "darwin":
      return "open";
    case "win32":
      return "explorer";
    default:
      return "xdg-open";
  }
};

const stripWrappingQuotes = (value: string) => value.replace(/^"+|"+$/g, "");

const resolvePathEnvironmentVariable = (env: NodeJS.ProcessEnv) => env.PATH ?? env.Path ?? env.path ?? "";

const resolveWindowsPathExtensions = (env: NodeJS.ProcessEnv): readonly string[] => {
  const rawValue = env.PATHEXT;
  const fallback = [".COM", ".EXE", ".BAT", ".CMD"];

  if (!rawValue) {
    return fallback;
  }

  const parsed = rawValue
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => (entry.startsWith(".") ? entry.toUpperCase() : `.${entry.toUpperCase()}`));

  return parsed.length > 0 ? Array.from(new Set(parsed)) : fallback;
};

const resolveCommandCandidates = (
  command: string,
  platform: NodeJS.Platform,
  windowsPathExtensions: readonly string[]
): readonly string[] => {
  if (platform !== "win32") {
    return [command];
  }

  const extension = extname(command);
  const normalizedExtension = extension.toUpperCase();

  if (extension.length > 0 && windowsPathExtensions.includes(normalizedExtension)) {
    const commandWithoutExtension = command.slice(0, -extension.length);
    return Array.from(
      new Set([
        command,
        `${commandWithoutExtension}${normalizedExtension}`,
        `${commandWithoutExtension}${normalizedExtension.toLowerCase()}`
      ])
    );
  }

  const candidates: string[] = [];
  for (const nextExtension of windowsPathExtensions) {
    candidates.push(`${command}${nextExtension}`);
    candidates.push(`${command}${nextExtension.toLowerCase()}`);
  }

  return Array.from(new Set(candidates));
};

const isExecutableFile = (
  filePath: string,
  platform: NodeJS.Platform,
  windowsPathExtensions: readonly string[]
) => {
  try {
    const stat = statSync(filePath);

    if (!stat.isFile()) {
      return false;
    }

    if (platform === "win32") {
      const extension = extname(filePath);
      if (extension.length === 0) {
        return false;
      }
      return windowsPathExtensions.includes(extension.toUpperCase());
    }

    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const resolvePathDelimiter = (platform: NodeJS.Platform) => (platform === "win32" ? ";" : ":");

export const isCommandAvailable = (
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
) => {
  const windowsPathExtensions = platform === "win32" ? resolveWindowsPathExtensions(env) : [];
  const commandCandidates = resolveCommandCandidates(command, platform, windowsPathExtensions);

  if (command.includes("/") || command.includes("\\")) {
    return commandCandidates.some((candidate) =>
      isExecutableFile(candidate, platform, windowsPathExtensions)
    );
  }

  const pathValue = resolvePathEnvironmentVariable(env);
  if (pathValue.length === 0) {
    return false;
  }

  const pathEntries = pathValue
    .split(resolvePathDelimiter(platform))
    .map((entry) => stripWrappingQuotes(entry.trim()))
    .filter((entry) => entry.length > 0);

  for (const pathEntry of pathEntries) {
    for (const candidate of commandCandidates) {
      if (isExecutableFile(join(pathEntry, candidate), platform, windowsPathExtensions)) {
        return true;
      }
    }
  }

  return false;
};

export const resolveAvailableEditors = (
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): EditorId[] => {
  const available: EditorId[] = [];

  for (const editor of EDITORS) {
    const command = editor.command ?? fileManagerCommandForPlatform(platform);
    if (isCommandAvailable(command, platform, env)) {
      available.push(editor.id);
    }
  }

  return available;
};

export const resolveEditorLaunch = (
  targetPath: string,
  editor: EditorId,
  platform: NodeJS.Platform = process.platform
): EditorLaunch => {
  const definition = EDITORS.find((entry) => entry.id === editor);

  if (!definition) {
    throw new Error(`Unknown editor: ${editor}`);
  }

  if (definition.command) {
    return shouldUseGotoFlag(definition.id, targetPath)
      ? { command: definition.command, args: ["--goto", targetPath] }
      : { command: definition.command, args: [targetPath] };
  }

  return {
    command: fileManagerCommandForPlatform(platform),
    args: [stripLineColumnSuffix(targetPath)]
  };
};

export const openInEditor = async (
  targetPath: string,
  editor: EditorId,
  platform: NodeJS.Platform = process.platform
) => {
  const launch = resolveEditorLaunch(targetPath, editor, platform);

  if (!isCommandAvailable(launch.command, platform)) {
    throw new Error(`Editor command not found: ${launch.command}`);
  }

  await new Promise<void>((resolve, reject) => {
    let child;

    try {
      child = spawn(launch.command, launch.args, {
        detached: true,
        stdio: "ignore",
        shell: platform === "win32"
      });
    } catch (error) {
      reject(error);
      return;
    }

    child.once("spawn", () => {
      child.unref();
      resolve();
    });
    child.once("error", reject);
  });
};
