import { getContainingDirectoryPath, joinFilePath } from "@/lib/path.js";
import type { WorkspaceFileTreeRow } from "@/workspace-file-tree/model.js";
import type { WorkspaceFileTreeEditingSession } from "@/workspace-file-tree/types.js";

/**
 * 文件树行内编辑（新建/重命名）的纯逻辑：名称校验、新建目标目录解析、
 * 草稿行注入位置。与服务端 workspaceFileOps 的校验保持同一规则，
 * 服务侧仍为最终裁决；这里先拦截常见错误避免无效 RPC。
 */

export type WorkspaceEntryNameError = "empty" | "reserved" | "separator";

export function getWorkspaceEntryNameError(name: string): WorkspaceEntryNameError | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return "empty";
  }
  if (trimmed === "." || trimmed === "..") {
    return "reserved";
  }
  if (/[/\\]/.test(trimmed) || trimmed.includes("\0")) {
    return "separator";
  }
  return null;
}

/** 新建草稿行的占位 path：不与真实磁盘路径冲突（名字带 NUL 前缀不可能落盘）。 */
export function createWorkspaceFileTreeDraftPath(parentPath: string): string {
  return joinFilePath(parentPath, ".zcode-editing-draft");
}

/** 右键「新建」的目标目录：目录行→自身；文件行→父目录。 */
export function resolveWorkspaceFileCreateParentPath(row: WorkspaceFileTreeRow): string | null {
  if (row.type === "directory") {
    return row.path;
  }
  return getContainingDirectoryPath(row.path);
}

export function createWorkspaceFileTreeEditingSession(params: {
  mode: "create-file" | "create-directory";
  parentPath: string;
}): WorkspaceFileTreeEditingSession {
  const kind = params.mode === "create-directory" ? "directory" : "file";
  return {
    mode: params.mode,
    parentPath: params.parentPath,
    draftPath: createWorkspaceFileTreeDraftPath(params.parentPath),
    kind,
    initialName: "",
  };
}

export function createWorkspaceFileTreeRenameSession(
  row: WorkspaceFileTreeRow,
): WorkspaceFileTreeEditingSession {
  return {
    mode: "rename",
    targetPath: row.path,
    kind: row.type === "directory" ? "directory" : "file",
    initialName: row.name,
  };
}

/**
 * 把 create 草稿行注入扁平 rows：父目录行之后、depth+1；
 * 根目录新建（parentPath 不在 rows 中）→ 列表顶部 depth 0。
 * 父目录行缺失且非根目录时返回原数组（等父目录展开后再出现）。
 */
export function injectWorkspaceFileTreeDraftRow(params: {
  rows: WorkspaceFileTreeRow[];
  session: WorkspaceFileTreeEditingSession;
  workspacePath: string;
}): WorkspaceFileTreeRow[] {
  const { rows, session, workspacePath } = params;
  if (session.mode === "rename" || !session.parentPath || !session.draftPath) {
    return rows;
  }
  const parentIndex = rows.findIndex((row) => row.path === session.parentPath);
  const isRootParent =
    session.parentPath === workspacePath ||
    session.parentPath === workspacePath.replace(/[/\\]+$/, "");
  if (parentIndex < 0 && !isRootParent) {
    return rows;
  }
  const depth = (rows[parentIndex]?.depth ?? -1) + 1;
  const draftRow: WorkspaceFileTreeRow = {
    path: session.draftPath,
    name: "",
    type: session.kind,
    depth,
    expanded: false,
    loaded: true,
    loading: false,
    error: null,
    editing: "create",
  };
  const index = parentIndex >= 0 ? parentIndex + 1 : 0;
  return [...rows.slice(0, index), draftRow, ...rows.slice(index)];
}

/** 重命名 Input 默认选中 basename（不含扩展名），与 VS Code 重命名一致。 */
export function getWorkspaceEntryRenameSelectionEnd(name: string): number {
  const dotIndex = name.lastIndexOf(".");
  // 隐藏文件（.env）整个名字都算 basename；普通文件只选中扩展名前的部分。
  return dotIndex > 0 ? dotIndex : name.length;
}
