// ============================================================
// Global Memory Section Builder
// ============================================================

import {
  GLOBAL_MEMORY_CHARACTER_LIMIT,
  type GlobalMemoryEntryInjection,
} from "../../memory/global-content.js";
import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";

/**
 * 全局（跨工作区）记忆段：目录下单条 Markdown 记忆按本轮选择顺序注入。
 * 附带"仅在用户明确要求时才编辑、单文件 ≤ 2048 字符"的行为约束（总条数不设限：默认不注入、用户逐条 opt-in）。
 * 与项目记忆一致放在 dynamic system block（随内容变化，不命中稳定缓存）。
 * 无可注入条目时返回 null（无效 id/已删除记忆不产生空段）。
 */
export function buildGlobalMemorySection(input: {
  dir: string;
  memories: readonly GlobalMemoryEntryInjection[];
}): ContextSection | null {
  if (input.memories.length === 0) return null;

  const blocks = input.memories.map((entry) => {
    const body = entry.content.trim().length > 0 ? entry.content.trim() : "(empty)";
    return `Contents of ${entry.filePath} (global memory "${entry.id}"):\n${body}`;
  });

  const body = [
    "# Global Memory",
    "",
    `You have a global memory directory shared across ALL workspaces and conversations at \`${input.dir}\`. Each memory is one Markdown file; the entries selected for this turn are shown below. Apply them here as standing context.`,
    "",
    "Rules:",
    "- Only edit files under this directory when the user explicitly asks you to remember or save something globally. Do not modify them on your own initiative.",
    "- Files here are stored encrypted (enc:v1 AES-256-GCM) — reading them directly returns ciphertext, so rely on the injected contents below instead of file reads.",
    "- To update a memory, write the complete new plaintext Markdown to the same path; to add one, create `<slug>.md` (lowercase letters/digits/hyphens, 1-40 chars). The app encrypts file contents on the next read/persist.",
    `- Keep each file at or under ${GLOBAL_MEMORY_CHARACTER_LIMIT} characters (frontmatter excluded).`,
    "",
    ...blocks,
  ].join("\n");

  return {
    name: "Global Memory",
    source: "global_memory",
    injectionTarget: "system",
    cacheHint: "dynamic",
    chars: body.length,
    tokens: estimateTokens(body),
    content: body,
    preview: body.slice(0, 100),
  };
}
