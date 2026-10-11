// ============================================================
// Global Memory Section Builder
// ============================================================

import { GLOBAL_MEMORY_CHARACTER_LIMIT } from "../../memory/global-content.js";
import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";

/**
 * 全局（跨工作区）记忆段：内容是跨所有工作区共享、跨会话持久的记忆单文件，
 * 附带"仅在用户明确要求时才编辑、总长 ≤ 2048 字符"的行为约束。
 * 与项目记忆一致放在 dynamic system block（随内容变化，不命中稳定缓存）。
 */
export function buildGlobalMemorySection(input: {
  filePath: string;
  content: string;
}): ContextSection {
  const body = [
    "# Global Memory",
    "",
    `You have a global memory shared across ALL workspaces and conversations. It lives at \`${input.filePath}\` and its current content is shown below. Apply it here as standing context.`,
    "",
    "Rules:",
    "- Only edit this file when the user explicitly asks you to remember or save something globally. Do not modify it on your own initiative.",
    `- Keep the whole file at or under ${GLOBAL_MEMORY_CHARACTER_LIMIT} characters.`,
    "",
    input.content.trim().length > 0 ? `Current global memory:\n${input.content.trim()}` : "(empty)",
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
