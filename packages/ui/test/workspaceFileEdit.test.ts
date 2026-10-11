import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceFileTreeRow } from "../src/workspace-file-tree/model.js";
import {
  createWorkspaceFileTreeEditingSession,
  createWorkspaceFileTreeRenameSession,
  getWorkspaceEntryNameError,
  getWorkspaceEntryRenameSelectionEnd,
  injectWorkspaceFileTreeDraftRow,
  resolveWorkspaceFileCreateParentPath,
} from "../src/workspace-file-tree/workspaceFileEdit.js";

function makeRow({
  path,
  ...overrides
}: Partial<WorkspaceFileTreeRow> & { path: string }): WorkspaceFileTreeRow {
  const name = overrides.name ?? path.split("/").pop() ?? path;
  return {
    path,
    name,
    type: "file",
    depth: 0,
    expanded: false,
    loaded: true,
    loading: false,
    error: null,
    ...overrides,
  };
}

test("getWorkspaceEntryNameError mirrors service-side rules", () => {
  assert.equal(getWorkspaceEntryNameError(""), "empty");
  assert.equal(getWorkspaceEntryNameError("   "), "empty");
  assert.equal(getWorkspaceEntryNameError(".."), "reserved");
  assert.equal(getWorkspaceEntryNameError("a/b"), "separator");
  assert.equal(getWorkspaceEntryNameError("a\\b"), "separator");
  assert.equal(getWorkspaceEntryNameError("notes.md"), null);
});

test("resolveWorkspaceFileCreateParentPath targets the row itself for directories", () => {
  const directory = makeRow({ path: "/ws/src/components", type: "directory" });
  assert.equal(resolveWorkspaceFileCreateParentPath(directory), "/ws/src/components");
  const file = makeRow({ path: "/ws/src/index.ts" });
  assert.equal(resolveWorkspaceFileCreateParentPath(file), "/ws/src");
});

test("injectWorkspaceFileTreeDraftRow inserts at root top for workspace-level create", () => {
  const rows = [
    makeRow({ path: "/ws/src", type: "directory" }),
    makeRow({ path: "/ws/package.json" }),
  ];
  const session = createWorkspaceFileTreeEditingSession({
    mode: "create-file",
    parentPath: "/ws",
  });
  const injected = injectWorkspaceFileTreeDraftRow({ rows, session, workspacePath: "/ws" });
  assert.equal(injected.length, 3);
  const draft = injected[0];
  assert.ok(draft);
  assert.equal(draft.editing, "create");
  assert.equal(draft.depth, 0);
  assert.equal(draft.type, "file");
  assert.equal(draft.path, session.draftPath);
});

test("injectWorkspaceFileTreeDraftRow nests the draft right after the parent directory", () => {
  const rows = [
    makeRow({ path: "/ws/src", type: "directory", expanded: true }),
    makeRow({ path: "/ws/src/index.ts", depth: 1 }),
    makeRow({ path: "/ws/README.md" }),
  ];
  const session = createWorkspaceFileTreeEditingSession({
    mode: "create-directory",
    parentPath: "/ws/src",
  });
  const injected = injectWorkspaceFileTreeDraftRow({ rows, session, workspacePath: "/ws" });
  assert.equal(injected.length, 4);
  const draft = injected[1];
  assert.ok(draft);
  assert.equal(draft.editing, "create");
  assert.equal(draft.depth, 1);
  assert.equal(draft.type, "directory");
  // 草稿行紧跟父目录行，排在既有子项之前。
  assert.equal(injected[2]?.path, "/ws/src/index.ts");
});

test("injectWorkspaceFileTreeDraftRow is a no-op for rename sessions and missing parents", () => {
  const rows = [makeRow({ path: "/ws/src/index.ts" })];
  const renameSession = createWorkspaceFileTreeRenameSession(rows[0]!);
  assert.equal(renameSession.mode, "rename");
  assert.equal(renameSession.targetPath, "/ws/src/index.ts");
  assert.equal(
    injectWorkspaceFileTreeDraftRow({ rows, session: renameSession, workspacePath: "/ws" }),
    rows,
  );
  const orphanCreate = createWorkspaceFileTreeEditingSession({
    mode: "create-file",
    parentPath: "/ws/not-loaded-yet",
  });
  assert.equal(
    injectWorkspaceFileTreeDraftRow({ rows, session: orphanCreate, workspacePath: "/ws" }),
    rows,
  );
});

test("getWorkspaceEntryRenameSelectionEnd selects basename without extension", () => {
  assert.equal(getWorkspaceEntryRenameSelectionEnd("index.ts"), 5);
  assert.equal(getWorkspaceEntryRenameSelectionEnd(".env"), 4);
  assert.equal(getWorkspaceEntryRenameSelectionEnd("folder"), 6);
});
