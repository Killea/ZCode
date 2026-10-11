import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/**
 * workspace 文件树的写操作：新建、同目录重命名、永久删除。
 * 所有入口统一经过 resolve 归一化 + 根内含校验 + 名称校验，UI 传入
 * rootPath 后服务侧独立复核，防止 "../" 逃逸或误删工作区根目录。
 */

export type WorkspaceEntryKind = "file" | "directory";

/** 名称校验失败原因；UI 侧有同名镜像逻辑用于行内提示，服务侧以此为准。 */
export function validateWorkspaceEntryName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return "Entry name cannot be empty.";
  }
  if (trimmed === "." || trimmed === "..") {
    return "Entry name cannot be a relative path segment.";
  }
  // \0 会让 POSIX API 直接抛错，路径分隔符会把"新建"变成跨目录写入。
  if (/[/\\]/.test(trimmed) || trimmed.includes("\0")) {
    return "Entry name cannot contain path separators.";
  }
  return null;
}

function assertValidWorkspaceEntryName(name: string): string {
  const error = validateWorkspaceEntryName(name);
  if (error) {
    throw new Error(error);
  }
  return name.trim();
}

/**
 * 词法归一化后的根内含校验。路径来自文件树 readdir 结果，词法 resolve 足够；
 * strict 模式拒绝 rootPath 本身（不能删除/重命名工作区根目录）。
 */
function resolveInsideWorkspaceRoot(
  rootPath: string,
  targetPath: string,
  { allowRoot = false }: { allowRoot?: boolean } = {},
): string {
  const resolvedRoot = resolve(rootPath);
  const resolvedTarget = resolve(targetPath);
  if (resolvedTarget === resolvedRoot) {
    if (allowRoot) {
      return resolvedTarget;
    }
    throw new Error(`Refusing to modify the workspace root: ${targetPath}`);
  }
  if (!resolvedTarget.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Path is outside the workspace root: ${targetPath}`);
  }
  return resolvedTarget;
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

export async function createWorkspaceEntry(params: {
  rootPath: string;
  parentPath: string;
  name: string;
  kind: WorkspaceEntryKind;
}): Promise<{ path: string }> {
  const name = assertValidWorkspaceEntryName(params.name);
  const parentPath = resolveInsideWorkspaceRoot(params.rootPath, params.parentPath, {
    allowRoot: true,
  });
  const parentStat = await stat(parentPath).catch(() => null);
  if (!parentStat?.isDirectory()) {
    throw new Error(`Parent path is not a directory: ${parentPath}`);
  }
  const targetPath = join(parentPath, name);
  if (params.kind === "directory") {
    // 不带 recursive：目标已存在时 EEXIST 报错，父目录缺失时 ENOENT 报错，
    // 不会静默创建中间层级。
    await mkdir(targetPath);
  } else {
    // "wx" 独占创建：目标已存在时 EEXIST 报错，不覆盖既有内容。
    await writeFile(targetPath, "", { flag: "wx" });
  }
  return { path: targetPath };
}

export async function renameWorkspaceEntry(params: {
  rootPath: string;
  path: string;
  newName: string;
}): Promise<{ path: string }> {
  const name = assertValidWorkspaceEntryName(params.newName);
  const sourcePath = resolveInsideWorkspaceRoot(params.rootPath, params.path);
  const targetPath = join(dirname(sourcePath), name);
  if (targetPath === sourcePath) {
    return { path: targetPath };
  }
  // POSIX rename 对已存在的普通文件/空目录会静默覆盖，必须先显式拒绝。
  if (await pathExists(targetPath)) {
    throw new Error(`A file or folder already exists: ${name}`);
  }
  await rename(sourcePath, targetPath);
  return { path: targetPath };
}

export async function deleteWorkspaceEntry(params: {
  rootPath: string;
  path: string;
}): Promise<void> {
  const targetPath = resolveInsideWorkspaceRoot(params.rootPath, params.path);
  // 永久删除：远程 Host 无可靠桌面回收站，本地/远程统一走 rm 递归语义。
  await rm(targetPath, { recursive: true });
}
