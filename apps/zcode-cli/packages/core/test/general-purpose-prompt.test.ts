import assert from "node:assert/strict";
import test from "node:test";
import { buildGeneralPurposeSystemPrompt } from "../src/subagent/general-purpose.js";

// 内建 general-purpose 提示词是子代理执行质量的主要杠杆：本地实测表明
// 弱指令遵循模型对显式过程化指令高度敏感，以下关键规则缺失会直接表现为
// 未读先改、半途而废、报告含糊等实测缺陷。本测试锁住这些规则的存续。
test("general-purpose prompt frames the delegation contract", () => {
  const prompt = buildGeneralPurposeSystemPrompt();
  assert.ok(prompt.includes("delegated subagent"));
  assert.ok(prompt.includes("final assistant message is returned to the parent agent"));
  assert.ok(prompt.includes("only channel back"));
});

test("general-purpose prompt carries the execution discipline rules", () => {
  const prompt = buildGeneralPurposeSystemPrompt();
  assert.ok(prompt.includes("Complete the task fully"));
  assert.ok(prompt.includes("cannot ask the user questions mid-task"));
  assert.ok(prompt.includes("Read a file before editing"));
  assert.ok(prompt.includes("verify with the cheapest real check"));
  assert.ok(prompt.includes("check your last paragraph"));
  assert.ok(prompt.includes("never create report/summary/documentation files"));
});

test("general-purpose prompt excludes main-session-only constructs", () => {
  const prompt = buildGeneralPurposeSystemPrompt();
  // 桌面渲染指令与 ::code-comment 属于主会话 TUI/渲染语义，child 输出经父代理转发，不能出现。
  assert.ok(!prompt.includes("code-comment"));
  assert.ok(!prompt.includes("::"));
});
