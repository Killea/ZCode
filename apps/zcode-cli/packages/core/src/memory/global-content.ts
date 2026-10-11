import { join } from "node:path";

/** 全局（跨工作区）记忆单文件的字符上限（按 UTF-16 code unit，中文每字计 1）。 */
export const GLOBAL_MEMORY_CHARACTER_LIMIT = 2048;

const GLOBAL_MEMORY_FILE_NAME = "MEMORY.md";
const GLOBAL_MEMORY_DIRECTORY_NAME = "global";

/** 全局（跨工作区）记忆目录：{cliStorageRoot}/memories/global */
export function resolveGlobalMemoryDir(cliStorageRoot: string): string {
  return join(cliStorageRoot, "memories", GLOBAL_MEMORY_DIRECTORY_NAME);
}

/** 全局（跨工作区）记忆单文件：{cliStorageRoot}/memories/global/MEMORY.md */
export function resolveGlobalMemoryFile(cliStorageRoot: string): string {
  return join(resolveGlobalMemoryDir(cliStorageRoot), GLOBAL_MEMORY_FILE_NAME);
}

/**
 * 全局记忆内容格式化：trim 后按 2048 字符截断；超限在最后一个换行处裁剪并追加一行提示。
 * 空内容返回空串（调用方据此决定是否展示"empty"占位）。
 */
export function formatGlobalMemoryContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length <= GLOBAL_MEMORY_CHARACTER_LIMIT) return trimmed;

  const sliced = trimmed.slice(0, GLOBAL_MEMORY_CHARACTER_LIMIT);
  const lastNewline = sliced.lastIndexOf("\n");
  const cut = lastNewline > 0 ? sliced.slice(0, lastNewline) : sliced;
  return (
    `${cut}\n\n` +
    `> [Global memory truncated: ${trimmed.length} chars, limit ${GLOBAL_MEMORY_CHARACTER_LIMIT}. ` +
    `Trim it under Settings → Memory → Global.]`
  );
}
