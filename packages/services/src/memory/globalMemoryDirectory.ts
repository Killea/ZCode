import { lstat, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import {
  GLOBAL_MEMORY_CHARACTER_LIMIT,
  GLOBAL_MEMORY_CHARACTER_LIMIT_EXCEEDED_ERROR_CODE,
  GLOBAL_MEMORY_DEFAULT_ID,
  GLOBAL_MEMORY_DESCRIPTION_CHARACTER_LIMIT,
  GLOBAL_MEMORY_ID_INVALID_ERROR_CODE,
  GLOBAL_MEMORY_ID_PATTERN,
  GLOBAL_MEMORY_NAME_CHARACTER_LIMIT,
  GLOBAL_MEMORY_NAME_INVALID_ERROR_CODE,
  GLOBAL_MEMORY_NOT_FOUND_ERROR_CODE,
  type GlobalMemoryEntry,
  type GlobalMemoryEntryMeta,
} from "./memory.js";
import { atomicWriteText } from "#src/fs/atomicFileUtils.js";

// ============================================================
// 全局（跨工作区）记忆目录存储层
// ============================================================
// 目录布局：{root}/ 下一条记忆一个 Markdown 文件。
//   MEMORY.md   → id "default"（存量永久映射，保留字，不可创建）
//   <slug>.md   → id = slug（^[a-z0-9][a-z0-9-]{0,39}$）
//   default.md  → 忽略（与 MEMORY.md 双映射同 id）
//   其他文件名   → 忽略（不匹配 slug pattern）
// 文件结构：可选 `---` frontmatter（仅 name/description 两键）+ body。
// 静态加密：文件整体落盘为 `enc:v1:` 前缀的 AES-256-GCM 密文（文件名保持明文 slug）；
// 无前缀内容按明文兼容读，并在任一读写入口触发就地迁移。
// ============================================================

const logger = createServiceLogger("globalMemory");

const GLOBAL_MEMORY_INDEX_FILE_NAME = "MEMORY.md";
const GLOBAL_MEMORY_SLUG_FALLBACK = "memory";
const GLOBAL_MEMORY_FRONTMATTER_FENCE = "---";
export const GLOBAL_MEMORY_ENCRYPTED_PREFIX = "enc:v1:";

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function serviceError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

function invalidIdError(id: string): Error {
  return serviceError(`Invalid global memory id: ${id}`, GLOBAL_MEMORY_ID_INVALID_ERROR_CODE);
}

function notFoundError(id: string): Error {
  return serviceError(`Global memory not found: ${id}`, GLOBAL_MEMORY_NOT_FOUND_ERROR_CODE);
}

function characterLimitError(field: string, limit: number, actual: number): Error {
  return serviceError(
    `Global memory ${field} exceeds the ${limit}-character limit: ${actual} characters`,
    GLOBAL_MEMORY_CHARACTER_LIMIT_EXCEEDED_ERROR_CODE,
  );
}

/** id → 文件名；id 未通过 slug 校验时返回 undefined（不参与路径拼接）。 */
function fileNameForId(id: string): string | undefined {
  if (id === GLOBAL_MEMORY_DEFAULT_ID) return GLOBAL_MEMORY_INDEX_FILE_NAME;
  if (!GLOBAL_MEMORY_ID_PATTERN.test(id)) return undefined;
  return `${id}.md`;
}

function requireValidId(id: string): string {
  const fileName = fileNameForId(id);
  if (!fileName) throw invalidIdError(id);
  return fileName;
}

/** 文件名 → id；无法映射（非 .md / 非 slug / default.md）返回 undefined。 */
function idForFileName(fileName: string): string | undefined {
  if (fileName === GLOBAL_MEMORY_INDEX_FILE_NAME) return GLOBAL_MEMORY_DEFAULT_ID;
  if (!fileName.endsWith(".md")) return undefined;
  const slug = fileName.slice(0, -".md".length);
  // default.md 会与 MEMORY.md 双映射同一 id，扫描时一律忽略。
  if (slug === GLOBAL_MEMORY_DEFAULT_ID) return undefined;
  return GLOBAL_MEMORY_ID_PATTERN.test(slug) ? slug : undefined;
}

/** 静态加密 codec：与 credentialCipherProvider 同线格式（enc:v1 AES-256-GCM），由服务层注入。 */
export interface GlobalMemoryCodec {
  encrypt(plainText: string): string;
  /** 输入无 enc 前缀时应原样返回；密文无法解密时抛错。 */
  decrypt(storedText: string): string;
}

interface ParsedGlobalMemoryFile {
  name?: string;
  description?: string;
  body: string;
}

/**
 * 解析 `---` frontmatter：文件首行必须是 fence 才尝试解析，仅识别
 * `name:` / `description:` 两个单行键；其余行原样进 body。
 * 找不到闭合 fence 时整个文件视为 body（容错：agent/手写文件不强制 frontmatter）。
 */
function parseGlobalMemoryFrontmatter(raw: string): ParsedGlobalMemoryFile {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== GLOBAL_MEMORY_FRONTMATTER_FENCE) {
    return { body: raw };
  }
  let closeIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === GLOBAL_MEMORY_FRONTMATTER_FENCE) {
      closeIndex = i;
      break;
    }
  }
  if (closeIndex < 0) return { body: raw };

  const parsed: ParsedGlobalMemoryFile = {
    body: lines
      .slice(closeIndex + 1)
      .join("\n")
      .replace(/^\n+/, ""),
  };
  for (const line of lines.slice(1, closeIndex)) {
    const name = /^name:\s*(.*)$/.exec(line)?.[1]?.trim();
    if (name !== undefined && parsed.name === undefined) {
      parsed.name = name;
      continue;
    }
    const description = /^description:\s*(.*)$/.exec(line)?.[1]?.trim();
    if (description !== undefined && parsed.description === undefined) {
      parsed.description = description;
    }
  }
  if (!parsed.name) delete parsed.name;
  if (!parsed.description) delete parsed.description;
  return parsed;
}

/** frontmatter 单行字段消毒：折行会破坏解析，写入前剥离换行并 trim。 */
function sanitizeFrontmatterLine(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const sanitized = value.replace(/[\r\n]+/g, " ").trim();
  return sanitized.length > 0 ? sanitized : undefined;
}

/** 组装 canonical 文件文本：frontmatter（仅出现的字段）+ 空行 + body。 */
function serializeGlobalMemoryFile(input: {
  name?: string;
  description?: string;
  content: string;
}): string {
  const name = sanitizeFrontmatterLine(input.name);
  const description = sanitizeFrontmatterLine(input.description);
  if (name === undefined && description === undefined) return input.content;
  const frontmatter = [GLOBAL_MEMORY_FRONTMATTER_FENCE];
  if (name !== undefined) frontmatter.push(`name: ${name}`);
  if (description !== undefined) frontmatter.push(`description: ${description}`);
  frontmatter.push(GLOBAL_MEMORY_FRONTMATTER_FENCE);
  return `${frontmatter.join("\n")}\n\n${input.content}`;
}

/** 从显示名派生 slug：非法字符折叠为连字符；全非法（如纯中文）回退 "memory"。 */
function deriveGlobalMemorySlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || GLOBAL_MEMORY_SLUG_FALLBACK;
}

function toMeta(
  id: string,
  parsed: ParsedGlobalMemoryFile,
  updatedAt: number | null,
): GlobalMemoryEntryMeta {
  return {
    id,
    name: parsed.name ?? id,
    ...(parsed.description !== undefined ? { description: parsed.description } : {}),
    chars: parsed.body.length,
    updatedAt,
  };
}

async function readEntryFile(dir: string, id: string): Promise<{ raw: string; updatedAt: number }> {
  const fileName = requireValidId(id);
  const filePath = join(dir, fileName);
  const raw = await readFile(filePath, "utf-8");
  const info = await stat(filePath);
  return { raw, updatedAt: info.mtimeMs };
}

/** 解出文件明文；无 enc 前缀按明文兼容返回并标记 wasEncrypted=false。坏密文抛错由调用方定级。 */
export function decodeEntryText(raw: string, codec: GlobalMemoryCodec): {
  text: string;
  wasEncrypted: boolean;
} {
  if (!raw.startsWith(GLOBAL_MEMORY_ENCRYPTED_PREFIX)) {
    return { text: raw, wasEncrypted: false };
  }
  return { text: codec.decrypt(raw), wasEncrypted: true };
}

/**
 * 明文文件就地迁移为密文：先内存 roundtrip 验证密文可解，再 atomic 替换原文，
 * 避免写出一把打不开的锁。迁移失败保留原文件、仅告警（内容仍可服务）。
 */
export async function migratePlaintextEntry(
  filePath: string,
  plainText: string,
  codec: GlobalMemoryCodec,
): Promise<void> {
  try {
    const cipherText = codec.encrypt(plainText);
    if (codec.decrypt(cipherText) !== plainText) {
      logger.warn("[globalMemory] 密文 roundtrip 验证失败，保留明文文件", { filePath });
      return;
    }
    await atomicWriteText(filePath, cipherText);
  } catch (error) {
    logger.warn("[globalMemory] 明文记忆就地加密失败，保留原文件", {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** 排序规则：default 固定首位，其余按 name localeCompare + id 兜底（与 mtime 抖动解耦）。 */
function compareGlobalMemoryEntries(
  left: GlobalMemoryEntryMeta,
  right: GlobalMemoryEntryMeta,
): number {
  if (left.id === GLOBAL_MEMORY_DEFAULT_ID) return -1;
  if (right.id === GLOBAL_MEMORY_DEFAULT_ID) return 1;
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

export async function listGlobalMemoryEntries(
  dir: string,
  codec: GlobalMemoryCodec,
): Promise<GlobalMemoryEntryMeta[]> {
  let fileNames: string[];
  try {
    fileNames = await readdir(dir);
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }

  const entries: GlobalMemoryEntryMeta[] = [];
  for (const fileName of fileNames) {
    const id = idForFileName(fileName);
    if (!id) continue;
    const filePath = join(dir, fileName);
    try {
      const metadata = await lstat(filePath);
      // 只允许普通文件：符号链接/目录不属于记忆条目，防止目录外内容被当记忆读。
      if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
      const raw = await readFile(filePath, "utf-8");
      const { text, wasEncrypted } = decodeEntryText(raw, codec);
      if (!wasEncrypted) {
        await migratePlaintextEntry(filePath, text, codec);
      }
      entries.push(toMeta(id, parseGlobalMemoryFrontmatter(text), metadata.mtimeMs));
    } catch (error) {
      if (isNotFoundError(error)) continue;
      // 坏密文/非法密文不应拖垮整个列表：跳过该条目（与 ENOENT 同策略），留 warn 可排查。
      logger.warn("[globalMemory] 跳过无法读取的记忆文件", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  entries.sort(compareGlobalMemoryEntries);
  return entries;
}

export async function readGlobalMemoryEntry(
  dir: string,
  id: string,
  codec: GlobalMemoryCodec,
): Promise<GlobalMemoryEntry & { exists: boolean }> {
  const filePath = join(dir, requireValidId(id));
  try {
    const { raw, updatedAt } = await readEntryFile(dir, id);
    const { text, wasEncrypted } = decodeEntryText(raw, codec);
    if (!wasEncrypted) {
      await migratePlaintextEntry(filePath, text, codec);
    }
    const parsed = parseGlobalMemoryFrontmatter(text);
    return { ...toMeta(id, parsed, updatedAt), content: parsed.body, exists: true };
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        id,
        name: id,
        content: "",
        chars: 0,
        updatedAt: null,
        exists: false,
      };
    }
    throw error;
  }
}

function validateEntryFields(input: {
  content: string;
  name?: string;
  description?: string;
}): void {
  if (input.content.length > GLOBAL_MEMORY_CHARACTER_LIMIT) {
    throw characterLimitError("content", GLOBAL_MEMORY_CHARACTER_LIMIT, input.content.length);
  }
  if (input.name !== undefined && input.name.length > GLOBAL_MEMORY_NAME_CHARACTER_LIMIT) {
    throw characterLimitError("name", GLOBAL_MEMORY_NAME_CHARACTER_LIMIT, input.name.length);
  }
  if (
    input.description !== undefined &&
    input.description.length > GLOBAL_MEMORY_DESCRIPTION_CHARACTER_LIMIT
  ) {
    throw characterLimitError(
      "description",
      GLOBAL_MEMORY_DESCRIPTION_CHARACTER_LIMIT,
      input.description.length,
    );
  }
}

export async function writeGlobalMemoryEntry(
  dir: string,
  input: {
    id: string;
    content: string;
    name?: string;
    description?: string;
  },
  codec: GlobalMemoryCodec,
): Promise<{ updatedAt: number }> {
  const fileName = requireValidId(input.id);
  validateEntryFields(input);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, fileName);
  // write 只更新已存在条目：非 default 缺失直接 NOT_FOUND——否则 write 会成为绕过
  // create 条数上限与 slug 派生的后门。default 例外（保留 writeGlobalMemoryFile
  // 的"首次保存即创建"兼容语义）；目标若是 symlink/非普通文件同样拒绝，
  // 防止写路径穿透到目录外。
  if (input.id !== GLOBAL_MEMORY_DEFAULT_ID) {
    try {
      const meta = await lstat(filePath);
      if (!meta.isFile() || meta.isSymbolicLink()) throw notFoundError(input.id);
    } catch (error) {
      if (isNotFoundError(error)) throw notFoundError(input.id);
      throw error;
    }
  }
  const serialized =
    input.name === undefined && input.description === undefined
      ? input.content
      : serializeGlobalMemoryFile(input);
  // 落盘一律整体加密；content 即明文载荷，序列化差异只影响 frontmatter 重组。
  await atomicWriteText(filePath, codec.encrypt(serialized));
  const info = await stat(filePath);
  return { updatedAt: info.mtimeMs };
}

export async function createGlobalMemoryEntry(
  dir: string,
  input: {
    name: string;
    description?: string;
    content?: string;
  },
  codec: GlobalMemoryCodec,
): Promise<{ id: string }> {
  const name = input.name.trim();
  if (name.length === 0) {
    throw serviceError(
      "Global memory name must not be empty",
      GLOBAL_MEMORY_NAME_INVALID_ERROR_CODE,
    );
  }
  validateEntryFields({
    content: input.content ?? "",
    name,
    description: input.description,
  });

  // 记忆总条数不设上限：默认不注入、用户逐条 opt-in 才发送，总量与 context 无关。
  const existingIds = new Set(
    (await listGlobalMemoryEntries(dir, codec)).map((entry) => entry.id),
  );

  // slug 冲突自动消解：<base>、<base>-2、<base>-3…；default 视为占用。
  const base = deriveGlobalMemorySlug(name);
  let slug = base;
  for (let suffix = 2; existingIds.has(slug) || slug === GLOBAL_MEMORY_DEFAULT_ID; suffix++) {
    slug = `${base}-${suffix}`.slice(0, 40);
  }

  const serialized = serializeGlobalMemoryFile({
    name,
    description: input.description,
    content: input.content ?? "",
  });
  await mkdir(dir, { recursive: true });
  await atomicWriteText(join(dir, `${slug}.md`), codec.encrypt(serialized));
  return { id: slug };
}

export async function deleteGlobalMemoryEntry(dir: string, id: string): Promise<void> {
  const fileName = requireValidId(id);
  try {
    await rm(join(dir, fileName));
  } catch (error) {
    if (isNotFoundError(error)) throw notFoundError(id);
    throw error;
  }
}
