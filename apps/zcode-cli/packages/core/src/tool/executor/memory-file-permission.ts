import { basename } from "node:path";
import type { PermissionDecisionResult } from "../../permission/service.js";
import {
  resolveContainedMemoryFilePath,
  resolveSafeMemoryFilePath,
} from "../../memory/memory-file-path.js";

interface MemoryFileTargetInput {
  executionInput: unknown;
  memoryRoot?: string;
  /** 全局（跨工作区）记忆目录；仅主 agent 且总开关开启时提供，只放行其下的 MEMORY.md。 */
  memoryGlobalRoot?: string;
  toolName: string;
  workingDirectory: string;
  workspaceRoot: string;
}

interface MemoryFilePermissionInput extends MemoryFileTargetInput {
  decision: PermissionDecisionResult;
}

interface ResolvedMemoryFileTarget {
  filePath: string;
  global: boolean;
}

export function applyMemoryFilePermission(
  input: MemoryFilePermissionInput,
): PermissionDecisionResult {
  const resolved = resolveMemoryFileTarget(input);
  if (!resolved) return input.decision;

  const rootDir = resolved.global ? input.memoryGlobalRoot : input.memoryRoot;
  if (
    !resolved.filePath.endsWith(".md") ||
    (resolved.global && basename(resolved.filePath) !== "MEMORY.md") ||
    !rootDir ||
    resolveSafeMemoryFilePath({
      filePath: resolved.filePath,
      rootDir,
      workingDirectory: input.workingDirectory,
      workspaceRoot: input.workspaceRoot,
    }) === undefined
  ) {
    return input.decision;
  }
  if (preservesExistingPermissionDecision(input.decision)) return input.decision;

  return {
    ...input.decision,
    allowed: true,
    decision: "allow",
    escalated: false,
    reason: "Memory Markdown writes are allowed",
    ruleId: "memory.file.markdown",
  };
}

export function targetsMemoryFile(input: MemoryFileTargetInput): boolean {
  return resolveMemoryFileTarget(input) !== undefined;
}

function resolveMemoryFileTarget(
  input: MemoryFileTargetInput,
): ResolvedMemoryFileTarget | undefined {
  if (input.toolName !== "Write" && input.toolName !== "Edit") return undefined;
  if (!input.memoryRoot && !input.memoryGlobalRoot) return undefined;

  const requestedPath = filePathFromInput(input.executionInput);
  if (!requestedPath) return undefined;

  const common = {
    filePath: requestedPath,
    workingDirectory: input.workingDirectory,
    workspaceRoot: input.workspaceRoot,
  };

  // 全局记忆优先：仅命中 global/MEMORY.md 单文件时按全局处理（两个根目录互不相交，无歧义）。
  if (input.memoryGlobalRoot) {
    const globalFile = resolveContainedMemoryFilePath({
      ...common,
      rootDir: input.memoryGlobalRoot,
    });
    if (globalFile !== undefined && basename(globalFile) === "MEMORY.md") {
      return { filePath: globalFile, global: true };
    }
  }

  const projectFile = input.memoryRoot
    ? resolveContainedMemoryFilePath({ ...common, rootDir: input.memoryRoot })
    : undefined;
  return projectFile !== undefined ? { filePath: projectFile, global: false } : undefined;
}

function filePathFromInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const filePath = (input as Record<string, unknown>).file_path;
  return typeof filePath === "string" && filePath.length > 0 ? filePath : undefined;
}

function preservesExistingPermissionDecision(decision: PermissionDecisionResult): boolean {
  if (decision.decision === "deny") {
    return decision.ruleId !== "mode.plan.nonReadOnly";
  }
  // alwaysAsk 是工具自报的"任何情况都要问"，这里不能把它放行掉。今天走不到这条分支
  // （只有 Write/Edit 会命中 memory 目标，二者都没声明 alwaysAsk），但一旦有人给它们加上，
  // 少了这个判断就会出现"memory 文件让模式无关的确认静默消失"——正是本旗标要防的事。
  if (decision.alwaysAsk) return true;
  return (
    decision.decision === "ask" &&
    (decision.ruleId === "rule.project.ask" || decision.ruleId === "hook.PreToolUse.ask")
  );
}
