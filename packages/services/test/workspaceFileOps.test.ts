import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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

test("validateWorkspaceEntryName rejects empty, reserved and separator names", () => {
  for (const name of ["", "   ", ".", "..", "a/b", "a\\b", "a\0b"]) {
    assert.notEqual(validateWorkspaceEntryName(name), null, `expected rejection: ${name}`);
  }
  assert.equal(validateWorkspaceEntryName("notes.md"), null);
  assert.equal(validateWorkspaceEntryName("  spaced name.txt  "), null);
});

test("createWorkspaceEntry creates file and directory inside the root", async () => {
  await withTempWorkspace(async (root) => {
    const dirResult = await createWorkspaceEntry({
      rootPath: root,
      parentPath: root,
      name: "docs",
      kind: "directory",
    });
    assert.equal((await stat(dirResult.path)).isDirectory(), true);

    const fileResult = await createWorkspaceEntry({
      rootPath: root,
      parentPath: dirResult.path,
      name: "readme.md",
      kind: "file",
    });
    assert.equal((await stat(fileResult.path)).isFile(), true);
  });
});

test("createWorkspaceEntry rejects existing targets and outside-root parents", async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(join(root, "existing.txt"), "keep me");
    await assert.rejects(
      createWorkspaceEntry({
        rootPath: root,
        parentPath: root,
        name: "existing.txt",
        kind: "file",
      }),
    );
    // 覆盖防护：已存在的文件内容不能被清空。
    assert.equal((await stat(join(root, "existing.txt"))).size > 0, true);
    await assert.rejects(
      createWorkspaceEntry({
        rootPath: root,
        parentPath: join(root, ".."),
        name: "escape.txt",
        kind: "file",
      }),
    );
    await assert.rejects(
      createWorkspaceEntry({
        rootPath: root,
        parentPath: join(root, "missing-parent"),
        name: "child.txt",
        kind: "file",
      }),
    );
  });
});

test("renameWorkspaceEntry renames within the same directory only", async () => {
  await withTempWorkspace(async (root) => {
    const source = join(root, "before.txt");
    await writeFile(source, "content");
    const result = await renameWorkspaceEntry({
      rootPath: root,
      path: source,
      newName: "after.txt",
    });
    assert.equal(result.path, join(root, "after.txt"));
    assert.equal(await readdir(root).then((names) => names.includes("after.txt")), true);
    assert.equal(await readdir(root).then((names) => names.includes("before.txt")), false);
  });
});

test("renameWorkspaceEntry refuses overwrite, root rename and escape names", async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(join(root, "a.txt"), "a");
    await writeFile(join(root, "b.txt"), "b");
    // POSIX rename 默认覆盖已有文件，必须显式拒绝。
    await assert.rejects(
      renameWorkspaceEntry({ rootPath: root, path: join(root, "a.txt"), newName: "b.txt" }),
    );
    assert.equal((await stat(join(root, "b.txt"))).size, 1);
    await assert.rejects(
      renameWorkspaceEntry({ rootPath: root, path: root, newName: "renamed-root" }),
    );
    await assert.rejects(
      renameWorkspaceEntry({
        rootPath: root,
        path: join(root, "a.txt"),
        newName: "nested/moved.txt",
      }),
    );
  });
});

test("deleteWorkspaceEntry removes files and directories recursively", async () => {
  await withTempWorkspace(async (root) => {
    const nested = join(root, "nested");
    await mkdir(join(nested, "deep"), { recursive: true });
    await writeFile(join(nested, "deep", "file.txt"), "x");
    await deleteWorkspaceEntry({ rootPath: root, path: nested });
    assert.equal(await readdir(root).then((names) => names.includes("nested")), false);
  });
});

test("deleteWorkspaceEntry refuses the workspace root and outside paths", async () => {
  await withTempWorkspace(async (root) => {
    await assert.rejects(deleteWorkspaceEntry({ rootPath: root, path: root }));
    await assert.rejects(
      deleteWorkspaceEntry({ rootPath: root, path: join(root, "..", "outside") }),
    );
  });
});
