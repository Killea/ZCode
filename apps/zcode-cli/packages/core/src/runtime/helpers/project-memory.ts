import type { AgentRuntimeConfig } from "../types.js";
import { resolveProjectMemoryRoot } from "../../memory/project-root.js";
import { resolveGlobalMemoryDir, resolveGlobalMemoryFile } from "../../memory/global-content.js";

export function resolveEnabledProjectMemoryRoot(
  config: AgentRuntimeConfig,
  workspacePath: string,
): string | undefined {
  const memory = config.memory;
  if (!memory?.enabled || memory.use === false || !memory.cliStorageRoot) return undefined;
  if (!isMainMemoryTaskType(config.taskType)) return undefined;

  return resolveProjectMemoryRoot({
    cliStorageRoot: memory.cliStorageRoot,
    workspaceIdentity: memory.workspaceIdentity,
    workspacePath,
  });
}

/** 全局（跨工作区）记忆文件路径；仅在总开关开启且为主 agent 任务类型时返回，否则 undefined。 */
export function resolveEnabledGlobalMemoryFile(config: AgentRuntimeConfig): string | undefined {
  const memory = config.memory;
  if (!memory?.globalEnabled || !memory.cliStorageRoot) return undefined;
  if (!isMainMemoryTaskType(config.taskType)) return undefined;
  return resolveGlobalMemoryFile(memory.cliStorageRoot);
}

/** 全局（跨工作区）记忆目录；主 agent 写权限门禁用，仅在总开关开启且为主 agent 时返回。 */
export function resolveEnabledGlobalMemoryDir(config: AgentRuntimeConfig): string | undefined {
  const memory = config.memory;
  if (!memory?.globalEnabled || !memory.cliStorageRoot) return undefined;
  if (!isMainMemoryTaskType(config.taskType)) return undefined;
  return resolveGlobalMemoryDir(memory.cliStorageRoot);
}

function isMainMemoryTaskType(taskType: AgentRuntimeConfig["taskType"]): boolean {
  return (
    taskType === undefined ||
    taskType === "interactive" ||
    taskType === "fork" ||
    taskType === "selection_side_chat" ||
    taskType === "workflow_parent"
  );
}
