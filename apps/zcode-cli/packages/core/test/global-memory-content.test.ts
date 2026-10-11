import assert from "node:assert/strict";
import test from "node:test";
import {
  GLOBAL_MEMORY_CHARACTER_LIMIT,
  formatGlobalMemoryContent,
  resolveGlobalMemoryDir,
  resolveGlobalMemoryFile,
} from "../src/memory/global-content.js";

// 全局（跨工作区）记忆单文件的格式化/路径契约：
// 空内容 → 空串；未超限 → trim 原样；恰好 2048 → 不截断；超限 → 按行尾裁剪并附提示。
// 这些是"注入侧 2048 上限"的第一道防线，任何回归都会让主 agent 读到超长上下文。

test("空内容 / 纯空白返回空字符串", () => {
  assert.equal(formatGlobalMemoryContent(""), "");
  assert.equal(formatGlobalMemoryContent("   \n\t  \n "), "");
});

test("未超限时返回 trim 后的原文", () => {
  const content = "记住：用户偏好中文回复。";
  assert.equal(formatGlobalMemoryContent(`  ${content}\n\n`), content);
});

test("恰好 2048 字符不截断", () => {
  const content = "字".repeat(GLOBAL_MEMORY_CHARACTER_LIMIT);
  assert.equal(formatGlobalMemoryContent(content), content);
});

test("超过 2048 时截断并附说明，正文不超限", () => {
  const content = "字".repeat(GLOBAL_MEMORY_CHARACTER_LIMIT + 952); // 3000 字符，无换行
  const out = formatGlobalMemoryContent(content);
  assert.notEqual(out, content);
  assert.match(out, /truncated/);
  assert.ok(out.includes(String(GLOBAL_MEMORY_CHARACTER_LIMIT)));

  const noteIndex = out.indexOf("> [Global memory truncated");
  assert.ok(noteIndex > 0, "应包含截断说明行");
  const body = out.slice(0, noteIndex).trimEnd();
  assert.ok(body.length <= GLOBAL_MEMORY_CHARACTER_LIMIT, "正文部分不得超过上限");
});

test("截断优先保留完整行（不在行中间半切）", () => {
  const line = "汉".repeat(100);
  const content = Array.from({ length: 25 }, () => line).join("\n"); // 25×100 + 24 换行 = 2524
  const out = formatGlobalMemoryContent(content);
  const noteIndex = out.indexOf("> [Global memory truncated");
  assert.ok(noteIndex > 0);
  const body = out.slice(0, noteIndex).replace(/\n+$/u, "");
  const lines = body.split("\n");
  assert.ok(lines.length > 0);
  // 保留的应是若干整行，每行长度都是 100 的整数倍（没有被半切的行）。
  for (const l of lines) {
    assert.equal(l.length % 100, 0, `保留行长度应为 100 的整数倍，实际 ${l.length}`);
  }
});

test("resolveGlobalMemoryDir / resolveGlobalMemoryFile 落在 global/MEMORY.md", () => {
  const root = "/home/u/.zcode/cli";
  assert.equal(resolveGlobalMemoryDir(root), "/home/u/.zcode/cli/memories/global");
  assert.equal(resolveGlobalMemoryFile(root), "/home/u/.zcode/cli/memories/global/MEMORY.md");
});
