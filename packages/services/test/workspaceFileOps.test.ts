import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  renameWorkspaceEntry,
  validateWorkspaceEntryName,
} from "../src/file/workspaceFileOps.js";

async function withTempWorkspace<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "zcode-file-ops-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("workspaceFileOps", () => {
  it("validateWorkspaceEntryName rejects empty, reserved and separator names", () => {
    for (const name of ["", "   ", ".", "..", "a/b", "a\\b", "a\0b"]) {
      expect(validateWorkspaceEntryName(name)).not.toBe(null, `expected rejection: ${name}`);
    }
    expect(validateWorkspaceEntryName("notes.md")).toBe(null);
    expect(validateWorkspaceEntryName("  spaced name.txt  ")).toBe(null);
  });

  it("createWorkspaceEntry creates file and directory inside the root", async () => {
    await withTempWorkspace(async (root) => {
      const dirResult = await createWorkspaceEntry({
        rootPath: root,
        parentPath: root,
        name: "docs",
        kind: "directory",
      });
      expect((await stat(dirResult.path)).isDirectory()).toBe(true);

      const fileResult = await createWorkspaceEntry({
        rootPath: root,
        parentPath: dirResult.path,
        name: "readme.md",
        kind: "file",
      });
      expect((await stat(fileResult.path)).isFile()).toBe(true);
    });
  });

  it("createWorkspaceEntry rejects existing targets and outside-root parents", async () => {
    await withTempWorkspace(async (root) => {
      await writeFile(join(root, "existing.txt"), "keep me");
      await expect(
        createWorkspaceEntry({
          rootPath: root,
          parentPath: root,
          name: "existing.txt",
          kind: "file",
        }),
      ).rejects.toThrow();
      // 覆盖防护：已存在的文件内容不能被清空。
      expect((await stat(join(root, "existing.txt"))).size > 0).toBe(true);
      await expect(
        createWorkspaceEntry({
          rootPath: root,
          parentPath: join(root, ".."),
          name: "escape.txt",
          kind: "file",
        }),
      ).rejects.toThrow();
      await expect(
        createWorkspaceEntry({
          rootPath: root,
          parentPath: join(root, "missing-parent"),
          name: "child.txt",
          kind: "file",
        }),
      ).rejects.toThrow();
    });
  });

  it("renameWorkspaceEntry renames within the same directory only", async () => {
    await withTempWorkspace(async (root) => {
      const source = join(root, "before.txt");
      await writeFile(source, "content");
      const result = await renameWorkspaceEntry({
        rootPath: root,
        path: source,
        newName: "after.txt",
      });
      expect(result.path).toBe(join(root, "after.txt"));
      expect(await readdir(root).then((names) => names.includes("after.txt"))).toBe(true);
      expect(await readdir(root).then((names) => names.includes("before.txt"))).toBe(false);
    });
  });

  it("renameWorkspaceEntry refuses overwrite, root rename and escape names", async () => {
    await withTempWorkspace(async (root) => {
      await writeFile(join(root, "a.txt"), "a");
      await writeFile(join(root, "b.txt"), "b");
      // POSIX rename 默认覆盖已有文件，必须显式拒绝。
      await expect(
        renameWorkspaceEntry({ rootPath: root, path: join(root, "a.txt"), newName: "b.txt" }),
      ).rejects.toThrow();
      expect((await stat(join(root, "b.txt"))).size).toBe(1);
      await expect(
        renameWorkspaceEntry({ rootPath: root, path: root, newName: "renamed-root" }),
      ).rejects.toThrow();
      await expect(
        renameWorkspaceEntry({
          rootPath: root,
          path: join(root, "a.txt"),
          newName: "nested/moved.txt",
        }),
      ).rejects.toThrow();
    });
  });

  it("deleteWorkspaceEntry removes files and directories recursively", async () => {
    await withTempWorkspace(async (root) => {
      const nested = join(root, "nested");
      await mkdir(join(nested, "deep"), { recursive: true });
      await writeFile(join(nested, "deep", "file.txt"), "x");
      await deleteWorkspaceEntry({ rootPath: root, path: nested });
      expect(await readdir(root).then((names) => names.includes("nested"))).toBe(false);
    });
  });

  it("deleteWorkspaceEntry refuses the workspace root and outside paths", async () => {
    await withTempWorkspace(async (root) => {
      await expect(deleteWorkspaceEntry({ rootPath: root, path: root })).rejects.toThrow();
      await expect(
        deleteWorkspaceEntry({ rootPath: root, path: join(root, "..", "outside") }),
      ).rejects.toThrow();
    });
  });
});
