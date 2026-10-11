import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export const PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED_ERROR_CODE =
  "PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED";
export const PROJECT_MEMORY_FILE_CHANGED_ERROR_CODE = "PROJECT_MEMORY_FILE_CHANGED";

/** 全局（跨工作区）记忆单文件的字符上限（按 UTF-16 code unit，中文每字计 1）。 */
export const GLOBAL_MEMORY_CHARACTER_LIMIT = 2048;
export const GLOBAL_MEMORY_CHARACTER_LIMIT_EXCEEDED_ERROR_CODE =
  "GLOBAL_MEMORY_CHARACTER_LIMIT_EXCEEDED";

export interface ProjectMemoryFileSummary {
  name: string;
  /** 已由 MemoryService 校验并限制在本地 Project Memory 根目录内的实际路径。 */
  path: string;
  kind: "index" | "item";
  size: number;
  updatedAt: number;
}

export interface ProjectMemoryWorkspaceSummary {
  id: string;
  label: string;
  updatedAt: number;
  files: ProjectMemoryFileSummary[];
}

export interface IMemoryService {
  /** 列出当前本地 profile 中可查看的 Project Memory。 */
  listProjectMemories(): Promise<ProjectMemoryWorkspaceSummary[]>;

  /** 原样读取一个 Project Memory Markdown 文件。 */
  readProjectMemoryFile(params: {
    workspaceId: string;
    fileName: string;
  }): Promise<{ content: string; updatedAt: number }>;

  /** 读取全局（跨工作区）记忆单文件；文件不存在时返回 exists:false 与空内容。 */
  readGlobalMemoryFile(): Promise<{ content: string; updatedAt: number | null; exists: boolean }>;

  /** 写入全局（跨工作区）记忆单文件（仅 MEMORY.md）；超过字符上限时抛错。 */
  writeGlobalMemoryFile(params: { content: string }): Promise<{ updatedAt: number }>;
}

export const IMemoryService = createServiceDescriptor<IMemoryService>(ServiceChannels.Memory);
