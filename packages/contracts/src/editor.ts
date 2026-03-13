export const EDITORS = [
  { id: "cursor", label: "Cursor", command: "cursor" },
  { id: "vscode", label: "VS Code", command: "code" },
  { id: "zed", label: "Zed", command: "zed" },
  { id: "file-manager", label: "File Manager", command: null }
] as const;

export type EditorId = (typeof EDITORS)[number]["id"];
