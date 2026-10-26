import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  GLOBAL_MEMORY_CHARACTER_LIMIT,
  GLOBAL_MEMORY_CHARACTER_LIMIT_EXCEEDED_ERROR_CODE,
  type IMemoryService,
} from "./memory.js";
import {
  createGlobalMemoryEntry,
  decodeEntryText,
  deleteGlobalMemoryEntry,
  listGlobalMemoryEntries,
  migratePlaintextEntry,
  readGlobalMemoryEntry,
  writeGlobalMemoryEntry,
} from "./globalMemoryDirectory.js";
import { createCredentialCipherProvider } from "#src/credential/providers/credentialCipherProvider.js";
import { atomicWriteText } from "#src/fs/atomicFileUtils.js";
import { getZCodeDataRootDir } from "#src/paths.js";

/** 全局（跨工作区）记忆目录：~/.zcode/cli/memories/global/ */
function getGlobalMemoryDir(): string {
  return join(getZCodeDataRootDir(), "cli", "memories", "global");
}

/** 全局（跨工作区）记忆单文件：~/.zcode/cli/memories/global/MEMORY.md */
function getGlobalMemoryFile(): string {
  return join(getGlobalMemoryDir(), "MEMORY.md");
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/**
 * 全局记忆服务切片：目录下多条 Markdown 记忆（MEMORY.md = default）。
 * 文件整体落盘为 enc:v1 AES-256-GCM 密文（复用 credential cipher 密钥口径），
 * 接口进出仍是明文；目录内明文文件在读写时自动就地迁移加密。
 * 兼容方法 readGlobalMemoryFile/writeGlobalMemoryFile 是 default 条目的原始别名，
 * 不解析 frontmatter，保持存量调用方字节级语义（解密后的正文内容）。
 */
export function createGlobalMemoryService(): Pick<
  IMemoryService,
  | "readGlobalMemoryFile"
  | "writeGlobalMemoryFile"
  | "listGlobalMemories"
  | "readGlobalMemory"
  | "writeGlobalMemory"
  | "createGlobalMemory"
  | "deleteGlobalMemory"
> {
  const codec = createCredentialCipherProvider();

  async function readGlobalMemoryFile(): Promise<{
    content: string;
    updatedAt: number | null;
    exists: boolean;
  }> {
    const filePath = getGlobalMemoryFile();
    try {
      const raw = await readFile(filePath, "utf-8");
      const info = await stat(filePath);
      // 接口语义保持明文返回；明文文件顺手就地迁移加密。
      const { text, wasEncrypted } = decodeEntryText(raw, codec);
      if (!wasEncrypted) {
        await migratePlaintextEntry(filePath, text, codec);
      }
      return { content: text, updatedAt: info.mtimeMs, exists: true };
    } catch (error) {
      if (isNotFoundError(error)) {
        return { content: "", updatedAt: null, exists: false };
      }
      throw error;
    }
  }

  async function writeGlobalMemoryFile(params: {
    content: string;
  }): Promise<{ updatedAt: number }> {
    if (params.content.length > GLOBAL_MEMORY_CHARACTER_LIMIT) {
      throw Object.assign(
        new Error(
          `Global memory exceeds the ${GLOBAL_MEMORY_CHARACTER_LIMIT}-character limit: ${params.content.length} characters`,
        ),
        { code: GLOBAL_MEMORY_CHARACTER_LIMIT_EXCEEDED_ERROR_CODE },
      );
    }
    const filePath = getGlobalMemoryFile();
    await atomicWriteText(filePath, codec.encrypt(params.content));
    const info = await stat(filePath);
    return { updatedAt: info.mtimeMs };
  }

  async function listGlobalMemories() {
    return listGlobalMemoryEntries(getGlobalMemoryDir(), codec);
  }

  async function readGlobalMemory(params: { id: string }) {
    return readGlobalMemoryEntry(getGlobalMemoryDir(), params.id, codec);
  }

  async function writeGlobalMemory(params: {
    id: string;
    content: string;
    name?: string;
    description?: string;
  }) {
    return writeGlobalMemoryEntry(getGlobalMemoryDir(), params, codec);
  }

  async function createGlobalMemory(params: {
    name: string;
    description?: string;
    content?: string;
  }) {
    return createGlobalMemoryEntry(getGlobalMemoryDir(), params, codec);
  }

  async function deleteGlobalMemory(params: { id: string }) {
    return deleteGlobalMemoryEntry(getGlobalMemoryDir(), params.id);
  }

  return {
    readGlobalMemoryFile,
    writeGlobalMemoryFile,
    listGlobalMemories,
    readGlobalMemory,
    writeGlobalMemory,
    createGlobalMemory,
    deleteGlobalMemory,
  };
}
