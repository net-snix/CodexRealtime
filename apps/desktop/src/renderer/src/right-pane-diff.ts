import type { TimelineChangedFile, TimelineDiffEntry } from "@shared";

export type DiffBrowserViewMode = "files" | "patch";

export interface ResolvedDiffBrowserView {
  selectedFile: TimelineChangedFile | null;
  title: string;
  subtitle: string;
  diff: string;
}

export interface DiffViewerLine {
  id: string;
  kind: "meta" | "hunk" | "added" | "removed" | "context";
  text: string;
  oldNumber: number | null;
  newNumber: number | null;
}

const DIFF_META_PREFIXES = [
  "diff --git",
  "index ",
  "--- ",
  "+++ ",
  "new file mode",
  "deleted file mode",
  "rename from",
  "rename to",
  "similarity index",
  "\\ No newline at end of file"
] as const;

const sortFiles = (files: TimelineChangedFile[]) =>
  [...files].sort((left, right) => left.path.localeCompare(right.path));

export const buildAggregateDiffEntry = (
  diffEntries: TimelineDiffEntry[]
): TimelineDiffEntry | null => {
  if (diffEntries.length === 0) {
    return null;
  }

  const files = new Map<string, TimelineChangedFile>();
  let additions = 0;
  let deletions = 0;

  for (const entry of diffEntries) {
    additions += entry.additions;
    deletions += entry.deletions;

    for (const file of entry.files) {
      const existing = files.get(file.path);

      if (!existing) {
        files.set(file.path, { ...file });
        continue;
      }

      files.set(file.path, {
        ...existing,
        additions: existing.additions + file.additions,
        deletions: existing.deletions + file.deletions,
        diff: [existing.diff?.trim(), file.diff?.trim()].filter(Boolean).join("\n") || null
      });
    }
  }

  return {
    id: "all-changes",
    kind: "diffSummary",
    createdAt: diffEntries.at(-1)?.createdAt ?? diffEntries[0]?.createdAt ?? "now",
    turnId: null,
    assistantMessageId: null,
    title: "All changes",
    diff: diffEntries
      .map((entry) => entry.diff.trim())
      .filter(Boolean)
      .join("\n"),
    files: sortFiles(Array.from(files.values())),
    additions,
    deletions
  };
};

export const buildDiffBrowserScopes = (
  diffEntries: TimelineDiffEntry[],
  activeDiffPreview: TimelineDiffEntry | null = null
) => {
  const aggregateEntry = buildAggregateDiffEntry(diffEntries);
  const revisionEntries = [...diffEntries].reverse();
  const scopes = aggregateEntry ? [aggregateEntry, ...revisionEntries] : revisionEntries;

  if (!activeDiffPreview || scopes.some((entry) => entry.id === activeDiffPreview.id)) {
    return scopes;
  }

  return [activeDiffPreview, ...scopes];
};

export const resolveViewerFile = (
  selectedDiff: TimelineDiffEntry | null,
  selectedFilePath: string | null
): TimelineChangedFile | null => {
  if (!selectedDiff || !selectedFilePath) {
    return null;
  }

  return selectedDiff.files.find((file) => file.path === selectedFilePath) ?? null;
};

export const resolveDiffBrowserView = (
  selectedDiff: TimelineDiffEntry | null,
  selectedFilePath: string | null,
  viewMode: DiffBrowserViewMode
): ResolvedDiffBrowserView | null => {
  if (!selectedDiff) {
    return null;
  }

  const selectedFile = resolveViewerFile(selectedDiff, selectedFilePath);
  const showFileDiff = viewMode === "files" && selectedFile !== null;

  return {
    selectedFile,
    title: showFileDiff ? selectedFile.path : selectedDiff.title,
    subtitle: showFileDiff
      ? `+${selectedFile.additions} -${selectedFile.deletions}`
      : `${selectedDiff.files.length} files · +${selectedDiff.additions} -${selectedDiff.deletions}`,
    diff: showFileDiff ? selectedFile.diff ?? "" : selectedDiff.diff
  };
};

const resolveDiffLineKind = (line: string): DiffViewerLine["kind"] => {
  if (line.startsWith("@@")) {
    return "hunk";
  }

  if (DIFF_META_PREFIXES.some((prefix) => line.startsWith(prefix))) {
    return "meta";
  }

  if (line.startsWith("+")) {
    return "added";
  }

  if (line.startsWith("-")) {
    return "removed";
  }

  return "context";
};

export const parseDiffViewerLines = (diff: string) => {
  const lines = diff.split("\n");
  const rendered: DiffViewerLine[] = [];
  let oldNumber: number | null = null;
  let newNumber: number | null = null;

  lines.forEach((line, index) => {
    const kind = resolveDiffLineKind(line);

    if (kind === "hunk") {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldNumber = match ? Number.parseInt(match[1], 10) : null;
      newNumber = match ? Number.parseInt(match[2], 10) : null;
      rendered.push({
        id: `diff-line-${index}`,
        kind,
        text: line,
        oldNumber: null,
        newNumber: null
      });
      return;
    }

    if (kind === "meta") {
      rendered.push({
        id: `diff-line-${index}`,
        kind,
        text: line,
        oldNumber: null,
        newNumber: null
      });
      return;
    }

    if (kind === "added") {
      rendered.push({
        id: `diff-line-${index}`,
        kind,
        text: line,
        oldNumber: null,
        newNumber
      });
      newNumber = newNumber === null ? null : newNumber + 1;
      return;
    }

    if (kind === "removed") {
      rendered.push({
        id: `diff-line-${index}`,
        kind,
        text: line,
        oldNumber,
        newNumber: null
      });
      oldNumber = oldNumber === null ? null : oldNumber + 1;
      return;
    }

    rendered.push({
      id: `diff-line-${index}`,
      kind,
      text: line,
      oldNumber,
      newNumber
    });

    oldNumber = oldNumber === null ? null : oldNumber + 1;
    newNumber = newNumber === null ? null : newNumber + 1;
  });

  return rendered;
};
