import assert from "node:assert/strict";
import test from "node:test";
import type { PermissionDecisionResult } from "../src/permission/service.js";
import {
  applyMemoryFilePermission,
  targetsMemoryFile,
} from "../src/tool/executor/memory-file-permission.js";

// 全局记忆写权限的契约：
// - 全局根下的 MEMORY.md → 放行（主 agent 在总开关开启时可写）；
// - 全局根下的其它 .md → 不放行（只放行单文件）；
// - 项目记忆根下的 .md → 仍放行（回归保护）；
// - 两个根之外的文件 → 不放行。
// 这是"主 agent 可读、按需可写、后台蒸馏不可达全局"中"可写"一侧的边界。

const WORKING_DIRECTORY = "/home/u/wd";
const WORKSPACE_ROOT = "/home/u/wd";
const GLOBAL_ROOT = "/home/u/.zcode/cli/memories/global";
const GLOBAL_FILE = "/home/u/.zcode/cli/memories/global/MEMORY.md";
const GLOBAL_OTHER = "/home/u/.zcode/cli/memories/global/other.md";
const PROJECT_ROOT = "/home/u/.zcode/cli/memories/projects/proj/memory";
const PROJECT_FILE = "/home/u/.zcode/cli/memories/projects/proj/memory/notes.md";
const OUTSIDE_FILE = "/home/u/wd/random.md";

function askDecision(): PermissionDecisionResult {
  return {
    decision: "ask",
    allowed: false,
    escalated: false,
    mode: "build",
    ruleId: "rule.default.ask",
    riskLevel: "low",
    reason: "Write requires confirmation",
  };
}

interface TargetInput {
  executionInput: { file_path: string };
  toolName: string;
  workingDirectory: string;
  workspaceRoot: string;
  memoryRoot?: string;
  memoryGlobalRoot?: string;
}

function apply(input: TargetInput): PermissionDecisionResult {
  return applyMemoryFilePermission({ decision: askDecision(), ...input });
}

test("全局 MEMORY.md 被放行", () => {
  const result = apply({
    executionInput: { file_path: GLOBAL_FILE },
    toolName: "Write",
    workingDirectory: WORKING_DIRECTORY,
    workspaceRoot: WORKSPACE_ROOT,
    memoryGlobalRoot: GLOBAL_ROOT,
  });
  assert.equal(result.decision, "allow");
  assert.equal(result.allowed, true);
  assert.equal(result.ruleId, "memory.file.markdown");
});

test("全局根下其它 .md 不放行（仅放行单文件）", () => {
  const result = apply({
    executionInput: { file_path: GLOBAL_OTHER },
    toolName: "Write",
    workingDirectory: WORKING_DIRECTORY,
    workspaceRoot: WORKSPACE_ROOT,
    memoryGlobalRoot: GLOBAL_ROOT,
  });
  assert.equal(result.decision, "ask");
  assert.equal(result.allowed, false);
});

test("项目记忆文件仍放行（回归保护，两根共存）", () => {
  const result = apply({
    executionInput: { file_path: PROJECT_FILE },
    toolName: "Edit",
    workingDirectory: WORKING_DIRECTORY,
    workspaceRoot: WORKSPACE_ROOT,
    memoryRoot: PROJECT_ROOT,
    memoryGlobalRoot: GLOBAL_ROOT,
  });
  assert.equal(result.decision, "allow");
  assert.equal(result.ruleId, "memory.file.markdown");
});

test("仅提供项目根时项目文件仍放行（无全局根）", () => {
  const result = apply({
    executionInput: { file_path: PROJECT_FILE },
    toolName: "Write",
    workingDirectory: WORKING_DIRECTORY,
    workspaceRoot: WORKSPACE_ROOT,
    memoryRoot: PROJECT_ROOT,
  });
  assert.equal(result.decision, "allow");
});

test("两个根之外的文件不放行", () => {
  const result = apply({
    executionInput: { file_path: OUTSIDE_FILE },
    toolName: "Write",
    workingDirectory: WORKING_DIRECTORY,
    workspaceRoot: WORKSPACE_ROOT,
    memoryRoot: PROJECT_ROOT,
    memoryGlobalRoot: GLOBAL_ROOT,
  });
  assert.equal(result.decision, "ask");
});

test("非 Write/Edit 工具一律不放行", () => {
  const result = apply({
    executionInput: { file_path: GLOBAL_FILE },
    toolName: "Bash",
    workingDirectory: WORKING_DIRECTORY,
    workspaceRoot: WORKSPACE_ROOT,
    memoryGlobalRoot: GLOBAL_ROOT,
  });
  assert.equal(result.decision, "ask");
});

test("targetsMemoryFile 只认记忆目标", () => {
  const base = {
    workingDirectory: WORKING_DIRECTORY,
    workspaceRoot: WORKSPACE_ROOT,
    memoryRoot: PROJECT_ROOT,
    memoryGlobalRoot: GLOBAL_ROOT,
  };
  assert.equal(
    targetsMemoryFile({ toolName: "Write", executionInput: { file_path: GLOBAL_FILE }, ...base }),
    true,
  );
  assert.equal(
    targetsMemoryFile({ toolName: "Write", executionInput: { file_path: GLOBAL_OTHER }, ...base }),
    false,
  );
  assert.equal(
    targetsMemoryFile({ toolName: "Write", executionInput: { file_path: PROJECT_FILE }, ...base }),
    true,
  );
  assert.equal(
    targetsMemoryFile({ toolName: "Write", executionInput: { file_path: OUTSIDE_FILE }, ...base }),
    false,
  );
});
