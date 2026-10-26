import { mkdir, mkdtemp, rm, symlink, truncate, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  lstat: vi.fn<typeof import("node:fs/promises").lstat>(),
  open: vi.fn<typeof import("node:fs/promises").open>(),
  readdir: vi.fn<typeof import("node:fs/promises").readdir>(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    lstat: fsMocks.lstat,
    open: fsMocks.open,
    readdir: fsMocks.readdir,
  };
});

import { createMemoryService } from "../src/memory/memoryService.js";
import { PROJECT_MEMORY_FILE_CHANGED_ERROR_CODE } from "../src/memory/memory.js";
import { createCredentialCipherProvider } from "../src/credential/providers/credentialCipherProvider.js";
import { getZCodeDataRootDir, setDataBaseDir } from "../src/paths.js";

let tempDir: string;
const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

function createNotFoundError(path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`ENOENT: no such file or directory, lstat '${path}'`), {
    code: "ENOENT",
  });
}

function projectsRoot(): string {
  return join(getZCodeDataRootDir(), "cli", "memories", "projects");
}

function workspaceMemoryRoot(workspaceId: string): string {
  return join(projectsRoot(), workspaceId, "memory");
}

async function writeMemoryFile(
  workspaceId: string,
  fileName: string,
  content: string,
  modifiedAt?: Date,
): Promise<void> {
  const memoryRoot = workspaceMemoryRoot(workspaceId);
  await mkdir(memoryRoot, { recursive: true });
  const filePath = join(memoryRoot, fileName);
  await writeFile(filePath, content, "utf-8");
  if (modifiedAt) {
    await utimes(filePath, modifiedAt, modifiedAt);
  }
}

beforeEach(async () => {
  fsMocks.lstat.mockReset();
  fsMocks.lstat.mockImplementation(actualFs.lstat);
  fsMocks.open.mockReset();
  fsMocks.open.mockImplementation(actualFs.open);
  fsMocks.readdir.mockReset();
  fsMocks.readdir.mockImplementation(actualFs.readdir);
  tempDir = await mkdtemp(join(tmpdir(), "zcode-project-memory-service-"));
  setDataBaseDir(tempDir);
});

afterEach(async () => {
  setDataBaseDir(null);
  await rm(tempDir, { recursive: true, force: true });
});

describe("memoryService Project Memory catalog", () => {
  it("缺少 Project Memory 根目录时返回空 catalog", async () => {
    const service = createMemoryService();

    await expect(service.listProjectMemories()).resolves.toEqual([]);
  });

  it("只列出非空 workspace，并稳定排序 index 与事实文件", async () => {
    const older = new Date("2026-01-01T00:00:00.000Z");
    const newer = new Date("2026-02-01T00:00:00.000Z");
    await writeMemoryFile("older-project-1111111111111111", "MEMORY.md", "older index", older);
    await writeMemoryFile("newer-project-2222222222222222", "z-last.md", "last", newer);
    await writeMemoryFile("newer-project-2222222222222222", "a-first.md", "first", newer);
    await writeMemoryFile("newer-project-2222222222222222", "MEMORY.md", "newer index", newer);
    await writeMemoryFile("newer-project-2222222222222222", "ignored.MD", "ignored", newer);
    await mkdir(workspaceMemoryRoot("empty-project-3333333333333333"), {
      recursive: true,
    });

    const workspaces = await createMemoryService().listProjectMemories();

    expect(workspaces.map((workspace) => workspace.id)).toEqual([
      "newer-project-2222222222222222",
      "older-project-1111111111111111",
    ]);
    expect(workspaces[0]).toMatchObject({
      id: "newer-project-2222222222222222",
      label: "newer-project",
      files: [
        {
          name: "MEMORY.md",
          kind: "index",
          path: join(workspaceMemoryRoot("newer-project-2222222222222222"), "MEMORY.md"),
        },
        { name: "a-first.md", kind: "item" },
        { name: "z-last.md", kind: "item" },
      ],
    });
    expect(workspaces[0]?.updatedAt).toBe(newer.getTime());
  });

  it("扫描期间 Memory 目录消失时跳过该 workspace", async () => {
    const workspaceId = "removed-memory-root-3333333333333333";
    await writeMemoryFile(workspaceId, "MEMORY.md", "temporary index");
    fsMocks.readdir.mockImplementationOnce(actualFs.readdir);
    fsMocks.readdir.mockRejectedValueOnce(createNotFoundError(workspaceMemoryRoot(workspaceId)));

    await expect(createMemoryService().listProjectMemories()).resolves.toEqual([]);
  });

  it("扫描期间事实文件消失时跳过该文件并保留其余 catalog", async () => {
    const workspaceId = "removed-fact-3333333333333333";
    const removedFilePath = join(workspaceMemoryRoot(workspaceId), "removed.md");
    await writeMemoryFile(workspaceId, "MEMORY.md", "remaining index");
    await writeMemoryFile(workspaceId, "removed.md", "temporary fact");
    fsMocks.lstat.mockImplementation(async (path, options) => {
      if (path === removedFilePath) {
        throw createNotFoundError(removedFilePath);
      }
      return actualFs.lstat(path, options);
    });

    await expect(createMemoryService().listProjectMemories()).resolves.toMatchObject([
      {
        id: workspaceId,
        files: [{ name: "MEMORY.md", kind: "index" }],
      },
    ]);
  });

  it("从当前 product data root 读取并原样返回 Markdown", async () => {
    const content = [
      "---",
      "name: exact-content",
      "metadata:",
      "  originSessionId: session-1",
      "---",
      "",
      "# Raw Memory",
      "",
    ].join("\n");
    await writeMemoryFile("exact-project-4444444444444444", "exact-content.md", content);

    await expect(
      createMemoryService().readProjectMemoryFile({
        workspaceId: "exact-project-4444444444444444",
        fileName: "exact-content.md",
      }),
    ).resolves.toMatchObject({ content });
  });

  it("打开后的句柄与已校验文件身份不一致时拒绝返回外部正文", async () => {
    const workspaceId = "swapped-file-4444444444444444";
    const fileName = "fact.md";
    const outsidePath = join(tempDir, "outside.md");
    await writeMemoryFile(workspaceId, fileName, "inside");
    await writeFile(outsidePath, "OUTSIDE_SECRET", "utf-8");
    fsMocks.open.mockImplementationOnce((_path, flags, mode) =>
      actualFs.open(outsidePath, flags, mode),
    );

    await expect(
      createMemoryService().readProjectMemoryFile({ workspaceId, fileName }),
    ).rejects.toMatchObject({
      code: PROJECT_MEMORY_FILE_CHANGED_ERROR_CODE,
      message: "Project Memory file changed during preview: fact.md",
    });
  });

  it.each(["workspace", "memory"] as const)(
    "打开文件时 %s 目录被替换为外部链接后拒绝返回正文",
    async (swapTarget) => {
      const workspaceId = `swapped-${swapTarget}-4444444444444444`;
      const fileName = "fact.md";
      const workspaceRoot = dirname(workspaceMemoryRoot(workspaceId));
      const memoryRoot = workspaceMemoryRoot(workspaceId);
      const externalWorkspace = join(tempDir, `external-${swapTarget}`);
      const externalMemoryRoot = join(externalWorkspace, "memory");
      await writeMemoryFile(workspaceId, fileName, "inside");
      await mkdir(externalMemoryRoot, { recursive: true });
      await writeFile(join(externalMemoryRoot, fileName), "OUTSIDE_SECRET", "utf-8");
      fsMocks.open.mockImplementationOnce(async (path, flags, mode) => {
        const target = swapTarget === "workspace" ? workspaceRoot : memoryRoot;
        const externalTarget = swapTarget === "workspace" ? externalWorkspace : externalMemoryRoot;
        await actualFs.rename(target, `${target}.original`);
        await actualFs.symlink(
          externalTarget,
          target,
          process.platform === "win32" ? "junction" : "dir",
        );
        return actualFs.open(path, flags, mode);
      });

      await expect(
        createMemoryService().readProjectMemoryFile({ workspaceId, fileName }),
      ).rejects.toThrow();
    },
  );

  it("稳定读取不阻塞并发原子更新，后续读取看到新正文", async () => {
    const workspaceId = "concurrent-update-4444444444444444";
    const fileName = "fact.md";
    const filePath = join(workspaceMemoryRoot(workspaceId), fileName);
    await writeMemoryFile(workspaceId, fileName, "before");
    fsMocks.open.mockImplementationOnce(async (path, flags, mode) => {
      // Bugfix: Windows 上持打开句柄期间 rename 同一目标必然 EPERM（POSIX 允许）。
      // mock 顺序改为"先完成原子替换、再打开句柄"，双平台语义一致：句柄指向新
      // inode，stable read 的三段 stat 校验仍能识别文件已变化，无需 win32 skip。
      const replacementPath = `${filePath}.replacement`;
      await writeFile(replacementPath, "after", "utf-8");
      await actualFs.rename(replacementPath, filePath);
      return actualFs.open(path, flags, mode);
    });

    const service = createMemoryService();
    await expect(service.readProjectMemoryFile({ workspaceId, fileName })).rejects.toMatchObject({
      code: PROJECT_MEMORY_FILE_CHANGED_ERROR_CODE,
      message: "Project Memory file changed during preview: fact.md",
    });
    await expect(actualFs.readFile(filePath, "utf-8")).resolves.toBe("after");
    await expect(service.readProjectMemoryFile({ workspaceId, fileName })).resolves.toMatchObject({
      content: "after",
    });
  });

  it("同一文件在预览期间被原地改写时拒绝返回不稳定正文", async () => {
    const workspaceId = "in-place-update-4444444444444444";
    const fileName = "fact.md";
    const filePath = join(workspaceMemoryRoot(workspaceId), fileName);
    await writeMemoryFile(workspaceId, fileName, "before");
    // 同长度紧邻写入可能落在同一个文件系统时钟刻度；固定旧 mtime，确保构造出可观测的版本变化。
    // 不用 sleep，也不绕过真实句柄读取及服务的最终 stat 校验。
    await utimes(filePath, new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));
    fsMocks.open.mockImplementationOnce(async (path, flags, mode) => {
      const handle = await actualFs.open(path, flags, mode);
      return {
        stat: handle.stat.bind(handle),
        read: async (buffer: Buffer, offset: number, length: number, position: number) => {
          await writeFile(filePath, "after!", "utf-8");
          return handle.read(buffer, offset, length, position);
        },
        close: handle.close.bind(handle),
      } as unknown as Awaited<ReturnType<typeof actualFs.open>>;
    });

    await expect(
      createMemoryService().readProjectMemoryFile({ workspaceId, fileName }),
    ).rejects.toMatchObject({
      code: PROJECT_MEMORY_FILE_CHANGED_ERROR_CODE,
      message: "Project Memory file changed during preview: fact.md",
    });
    await expect(actualFs.readFile(filePath, "utf-8")).resolves.toBe("after!");
  });

  it("拒绝预览超过 5 MiB 的 Project Memory 文件", async () => {
    const workspaceId = "large-project-5555555555555555";
    const fileName = "large.md";
    const filePath = join(workspaceMemoryRoot(workspaceId), fileName);
    await writeMemoryFile(workspaceId, fileName, "");
    await truncate(filePath, 5 * 1024 * 1024 + 1);

    await expect(
      createMemoryService().readProjectMemoryFile({ workspaceId, fileName }),
    ).rejects.toMatchObject({
      code: "PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED",
      message: "Project Memory file exceeds the 5 MiB preview limit: large.md",
    });
  });

  it("拒绝 traversal、路径分隔符和非 Memory Markdown 文件", async () => {
    const service = createMemoryService();

    await expect(
      service.readProjectMemoryFile({
        workspaceId: "../outside",
        fileName: "secret.md",
      }),
    ).rejects.toThrow();
    await expect(
      service.readProjectMemoryFile({
        workspaceId: "workspace-5555555555555555",
        fileName: "../secret.md",
      }),
    ).rejects.toThrow();
    await expect(
      service.readProjectMemoryFile({
        workspaceId: "workspace-5555555555555555",
        fileName: "secret.MD",
      }),
    ).rejects.toThrow();
    await expect(
      service.readProjectMemoryFile({
        workspaceId: "/absolute/workspace",
        fileName: "secret.md",
      }),
    ).rejects.toThrow();
    await expect(
      service.readProjectMemoryFile({
        workspaceId: "workspace-5555555555555555",
        fileName: "nested\\secret.md",
      }),
    ).rejects.toThrow();
  });

  it("读取时要求磁盘目录项名称与请求名称大小写完全一致", async () => {
    const workspaceId = "case-sensitive-project-6666666666666666";
    await writeMemoryFile(workspaceId, "SECRET.MD", "excluded uppercase extension");

    const service = createMemoryService();
    await expect(service.listProjectMemories()).resolves.toEqual([]);
    await expect(
      service.readProjectMemoryFile({ workspaceId, fileName: "secret.md" }),
    ).rejects.toThrow();
  });

  it("不跟随 workspace symlink", async () => {
    const externalWorkspace = join(tempDir, "external-project");
    await mkdir(join(externalWorkspace, "memory"), { recursive: true });
    await writeFile(join(externalWorkspace, "memory", "secret.md"), "external secret", "utf-8");
    await mkdir(projectsRoot(), { recursive: true });
    await symlink(
      externalWorkspace,
      join(projectsRoot(), "linked-project-6666666666666666"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const service = createMemoryService();
    await expect(service.listProjectMemories()).resolves.toEqual([]);
    await expect(
      service.readProjectMemoryFile({
        workspaceId: "linked-project-6666666666666666",
        fileName: "secret.md",
      }),
    ).rejects.toThrow();
  });

  it("不跟随 Project Memory 根目录 symlink", async () => {
    const externalProjectsRoot = join(tempDir, "external-projects");
    const workspaceId = "linked-projects-root-7777777777777777";
    await mkdir(join(externalProjectsRoot, workspaceId, "memory"), {
      recursive: true,
    });
    await writeFile(
      join(externalProjectsRoot, workspaceId, "memory", "outside.md"),
      "outside body",
      "utf-8",
    );
    await mkdir(dirname(projectsRoot()), { recursive: true });
    await symlink(
      externalProjectsRoot,
      projectsRoot(),
      process.platform === "win32" ? "junction" : "dir",
    );

    const service = createMemoryService();
    await expect(service.listProjectMemories()).rejects.toThrow();
    await expect(
      service.readProjectMemoryFile({ workspaceId, fileName: "outside.md" }),
    ).rejects.toThrow();
  });

  it("文件在 catalog 后被删除时向调用方返回原始读取错误", async () => {
    const workspaceId = "deleted-project-7777777777777777";
    const fileName = "deleted.md";
    await writeMemoryFile(workspaceId, fileName, "temporary");
    const service = createMemoryService();
    await expect(service.listProjectMemories()).resolves.toMatchObject([{ id: workspaceId }]);

    await unlink(join(workspaceMemoryRoot(workspaceId), fileName));

    await expect(service.readProjectMemoryFile({ workspaceId, fileName })).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

function globalMemoryRoot(): string {
  return join(getZCodeDataRootDir(), "cli", "memories", "global");
}

async function writeGlobalMemoryFileRaw(fileName: string, content: string): Promise<void> {
  const dir = globalMemoryRoot();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, fileName), content, "utf-8");
}

describe("memoryService global memory directory", () => {
  it("目录缺失时返回空列表，读取返回 exists:false", async () => {
    const service = createMemoryService();

    await expect(service.listGlobalMemories()).resolves.toEqual([]);
    await expect(service.readGlobalMemory({ id: "default" })).resolves.toEqual(
      expect.objectContaining({ exists: false, content: "" }),
    );
  });

  it("MEMORY.md 映射 default 且固定列表首位，其余按 name 排序", async () => {
    await writeGlobalMemoryFileRaw("zebra.md", "---\nname: Zeta\n---\n\nzeta body");
    await writeGlobalMemoryFileRaw("MEMORY.md", "legacy body");
    await writeGlobalMemoryFileRaw("alpha.md", "---\nname: Alpha\n---\n\nalpha body");

    const entries = await createMemoryService().listGlobalMemories();

    expect(entries.map((entry) => entry.id)).toEqual(["default", "alpha", "zebra"]);
    expect(entries[0]).toMatchObject({ name: "default", chars: 11 });
    expect(entries[1]?.name).toBe("Alpha");
    expect(entries[1]?.description).toBeUndefined();
  });

  it("忽略 default.md、非 slug 文件名、非 md 与符号链接", async () => {
    const dir = globalMemoryRoot();
    await writeGlobalMemoryFileRaw("MEMORY.md", "default body");
    await writeGlobalMemoryFileRaw("default.md", "shadow");
    await writeGlobalMemoryFileRaw("UPPER.md", "upper");
    await writeGlobalMemoryFileRaw("note.txt", "not markdown");
    await writeGlobalMemoryFileRaw("-bad.md", "bad slug");
    const outside = join(tempDir, "outside.md");
    await writeFile(outside, "OUTSIDE", "utf-8");
    await symlink(
      outside,
      join(dir, "linked.md"),
      process.platform === "win32" ? "junction" : "file",
    );

    const entries = await createMemoryService().listGlobalMemories();

    expect(entries.map((entry) => entry.id)).toEqual(["default"]);
  });

  it("frontmatter 只识别 name/description，缺省回退 id", async () => {
    await writeGlobalMemoryFileRaw(
      "prefs.md",
      [
        "---",
        "name: Preferences",
        "description: 用户偏好",
        "unknown: dropped",
        "---",
        "",
        "body text",
      ].join("\n"),
    );
    await writeGlobalMemoryFileRaw("bare.md", "plain body");

    const entries = await createMemoryService().listGlobalMemories();

    const prefs = entries.find((entry) => entry.id === "prefs");
    expect(prefs).toMatchObject({
      name: "Preferences",
      description: "用户偏好",
      chars: 9,
    });
    const bare = entries.find((entry) => entry.id === "bare");
    expect(bare).toMatchObject({ name: "bare", chars: 10 });
    expect(bare?.description).toBeUndefined();
  });

  it("readGlobalMemory 返回 body（剥离 frontmatter）；无 frontmatter 文件原样返回", async () => {
    await writeGlobalMemoryFileRaw("a.md", "---\nname: A\n---\n\nreal body\n");
    const service = createMemoryService();

    await expect(service.readGlobalMemory({ id: "a" })).resolves.toMatchObject({
      name: "A",
      content: "real body\n",
      exists: true,
    });
    await writeGlobalMemoryFileRaw("b.md", "no frontmatter");
    await expect(service.readGlobalMemory({ id: "b" })).resolves.toMatchObject({
      content: "no frontmatter",
      exists: true,
    });
  });

  it("非法 id 在 read/write/delete 上抛 GLOBAL_MEMORY_ID_INVALID", async () => {
    const service = createMemoryService();

    await expect(service.readGlobalMemory({ id: "../escape" })).rejects.toMatchObject({
      code: "GLOBAL_MEMORY_ID_INVALID",
    });
    await expect(service.writeGlobalMemory({ id: "Bad_Id", content: "x" })).rejects.toMatchObject({
      code: "GLOBAL_MEMORY_ID_INVALID",
    });
    await expect(service.deleteGlobalMemory({ id: "nested/slash" })).rejects.toMatchObject({
      code: "GLOBAL_MEMORY_ID_INVALID",
    });
  });

  it("create 由 name 派生 slug；冲突自动追加序号；中文名回退 memory", async () => {
    const service = createMemoryService();

    const first = await service.createGlobalMemory({ name: "Code Style" });
    expect(first.id).toBe("code-style");
    const second = await service.createGlobalMemory({ name: "code style!" });
    expect(second.id).toBe("code-style-2");
    const cjk = await service.createGlobalMemory({ name: "偏好" });
    expect(cjk.id).toBe("memory");
    const cjkAgain = await service.createGlobalMemory({ name: "偏好" });
    expect(cjkAgain.id).toBe("memory-2");

    const entry = await service.readGlobalMemory({ id: first.id });
    expect(entry).toMatchObject({ name: "Code Style", exists: true });
  });

  it("create 空 name 抛 GLOBAL_MEMORY_NAME_INVALID", async () => {
    await expect(createMemoryService().createGlobalMemory({ name: "   " })).rejects.toMatchObject({
      code: "GLOBAL_MEMORY_NAME_INVALID",
    });
  });

  it("create 保留字 default 不可占用（派生 slug 永不等于 default）", async () => {
    // 名字派生只会得到 slug 或 memory 回退；这里直接验证冲突消解不会产出保留 id。
    const service = createMemoryService();
    const created = await service.createGlobalMemory({ name: "default" });
    expect(created.id).not.toBe("default");
    expect(created.id).toBe("default-2");
  });

  it("create 无总条数上限：超过原 10 条限制仍可继续创建", async () => {
    const service = createMemoryService();
    for (let i = 0; i < 11; i++) {
      await service.createGlobalMemory({ name: `entry-${i}` });
    }

    await expect(service.listGlobalMemories()).resolves.toHaveLength(11);
  });

  it("write 仅 content 时不产生 frontmatter；提供 name/description 时重组 canonical frontmatter", async () => {
    const service = createMemoryService();
    const cipher = createCredentialCipherProvider();
    await service.writeGlobalMemory({ id: "default", content: "plain body" });

    // 落盘是 enc:v1 整体密文；解密后的明文载荷才走 frontmatter 序列化断言。
    const firstRaw = await actualFs.readFile(join(globalMemoryRoot(), "MEMORY.md"), "utf-8");
    expect(firstRaw.startsWith("enc:v1:")).toBe(true);
    expect(firstRaw).not.toContain("plain body");
    expect(cipher.decrypt(firstRaw)).toBe("plain body");

    await service.writeGlobalMemory({
      id: "default",
      content: "body v2",
      name: "Renamed",
      description: "desc",
    });
    const secondRaw = await actualFs.readFile(join(globalMemoryRoot(), "MEMORY.md"), "utf-8");
    expect(secondRaw.startsWith("enc:v1:")).toBe(true);
    expect(cipher.decrypt(secondRaw)).toBe("---\nname: Renamed\ndescription: desc\n---\n\nbody v2");
  });

  it("明文文件在 list/read 时就地迁移为 enc:v1 密文，且内容不变", async () => {
    await writeGlobalMemoryFileRaw("MEMORY.md", "secret body");
    await writeGlobalMemoryFileRaw("prefs.md", "---\nname: Prefs\n---\n\nprefs body");
    const service = createMemoryService();
    const cipher = createCredentialCipherProvider();
    const defaultPath = join(globalMemoryRoot(), "MEMORY.md");

    const entries = await service.listGlobalMemories();
    expect(entries.map((entry) => entry.id)).toEqual(["default", "prefs"]);

    // 迁移后磁盘只剩密文；roundtrip 可解且明文内容一致。
    const migrated = await actualFs.readFile(defaultPath, "utf-8");
    expect(migrated.startsWith("enc:v1:")).toBe(true);
    expect(migrated).not.toContain("secret body");
    expect(cipher.decrypt(migrated)).toBe("secret body");

    // 再次读取走密文路径，元数据不变。
    await expect(service.readGlobalMemory({ id: "prefs" })).resolves.toMatchObject({
      name: "Prefs",
      content: "prefs body",
      exists: true,
    });
  });

  it("坏密文/密钥不匹配的文件在列表中被跳过，单条 read 抛错", async () => {
    await writeGlobalMemoryFileRaw("ok.md", "fine body");
    await writeGlobalMemoryFileRaw("bad.md", "enc:v1:AAAA.BBBB.CCCC");
    const service = createMemoryService();

    const entries = await service.listGlobalMemories();
    expect(entries.map((entry) => entry.id)).toEqual(["ok"]);

    await expect(service.readGlobalMemory({ id: "bad" })).rejects.toThrow();
    // 坏密文不被迁移覆盖：仍是原文件内容，不丢数据。
    await expect(
      actualFs.readFile(join(globalMemoryRoot(), "bad.md"), "utf-8"),
    ).resolves.toBe("enc:v1:AAAA.BBBB.CCCC");
  });

  it("write 非 default 缺失抛 NOT_FOUND；default 缺失允许创建", async () => {
    const service = createMemoryService();

    await expect(service.writeGlobalMemory({ id: "missing", content: "x" })).rejects.toMatchObject({
      code: "GLOBAL_MEMORY_NOT_FOUND",
    });

    await service.writeGlobalMemory({ id: "default", content: "created" });
    await expect(service.readGlobalMemory({ id: "default" })).resolves.toMatchObject({
      content: "created",
      exists: true,
    });
  });

  it("write/read/delete 超过字符上限抛 GLOBAL_MEMORY_CHARACTER_LIMIT_EXCEEDED", async () => {
    const service = createMemoryService();
    const oversized = "x".repeat(2049);

    await expect(
      service.writeGlobalMemory({ id: "default", content: oversized }),
    ).rejects.toMatchObject({
      code: "GLOBAL_MEMORY_CHARACTER_LIMIT_EXCEEDED",
    });
    await expect(
      service.createGlobalMemory({ name: "big", content: oversized }),
    ).rejects.toMatchObject({
      code: "GLOBAL_MEMORY_CHARACTER_LIMIT_EXCEEDED",
    });
    await expect(
      service.writeGlobalMemory({
        id: "default",
        content: "ok",
        name: "n".repeat(81),
      }),
    ).rejects.toMatchObject({
      code: "GLOBAL_MEMORY_CHARACTER_LIMIT_EXCEEDED",
    });
  });

  it("delete 移除文件；缺失抛 GLOBAL_MEMORY_NOT_FOUND；default 删除 MEMORY.md", async () => {
    const service = createMemoryService();
    await service.createGlobalMemory({ name: "doomed" });
    await service.deleteGlobalMemory({ id: "doomed" });
    await expect(service.listGlobalMemories()).resolves.toEqual([]);

    await expect(service.deleteGlobalMemory({ id: "doomed" })).rejects.toMatchObject({
      code: "GLOBAL_MEMORY_NOT_FOUND",
    });

    await writeGlobalMemoryFileRaw("MEMORY.md", "legacy");
    await service.deleteGlobalMemory({ id: "default" });
    await expect(service.readGlobalMemory({ id: "default" })).resolves.toMatchObject({
      exists: false,
    });
  });

  it("兼容 API readGlobalMemoryFile/writeGlobalMemoryFile 仍读写 default 文件", async () => {
    const service = createMemoryService();
    await service.writeGlobalMemoryFile({ content: "legacy path" });

    // legacy 写路径同样落盘密文，读接口仍返回明文内容。
    const raw = await actualFs.readFile(join(globalMemoryRoot(), "MEMORY.md"), "utf-8");
    expect(raw.startsWith("enc:v1:")).toBe(true);
    expect(raw).not.toContain("legacy path");

    await expect(service.readGlobalMemoryFile()).resolves.toMatchObject({
      content: "legacy path",
      exists: true,
    });
    await expect(service.readGlobalMemory({ id: "default" })).resolves.toMatchObject({
      content: "legacy path",
      exists: true,
    });
  });
});
