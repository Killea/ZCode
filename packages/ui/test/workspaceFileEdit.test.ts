import { describe, expect, it } from "vitest";
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

describe("workspaceFileEdit", () => {
  it("getWorkspaceEntryNameError mirrors service-side rules", () => {
    expect(getWorkspaceEntryNameError("")).toBe("empty");
    expect(getWorkspaceEntryNameError("   ")).toBe("empty");
    expect(getWorkspaceEntryNameError("..")).toBe("reserved");
    expect(getWorkspaceEntryNameError("a/b")).toBe("separator");
    expect(getWorkspaceEntryNameError("a\\b")).toBe("separator");
    expect(getWorkspaceEntryNameError("notes.md")).toBe(null);
  });

  it("resolveWorkspaceFileCreateParentPath targets the row itself for directories", () => {
    const directory = makeRow({
      path: "/ws/src/components",
      type: "directory",
    });
    expect(resolveWorkspaceFileCreateParentPath(directory)).toBe(
      "/ws/src/components",
    );
    const file = makeRow({ path: "/ws/src/index.ts" });
    expect(resolveWorkspaceFileCreateParentPath(file)).toBe("/ws/src");
  });

  it("injectWorkspaceFileTreeDraftRow inserts at root top for workspace-level create", () => {
    const rows = [
      makeRow({ path: "/ws/src", type: "directory" }),
      makeRow({ path: "/ws/package.json" }),
    ];
    const session = createWorkspaceFileTreeEditingSession({
      mode: "create-file",
      parentPath: "/ws",
    });
    const injected = injectWorkspaceFileTreeDraftRow({
      rows,
      session,
      workspacePath: "/ws",
    });
    expect(injected.length).toBe(3);
    const draft = injected[0];
    expect(draft).toBeTruthy();
    expect(draft!.editing).toBe("create");
    expect(draft!.depth).toBe(0);
    expect(draft!.type).toBe("file");
    expect(draft!.path).toBe(session.draftPath);
  });

  it("injectWorkspaceFileTreeDraftRow nests the draft right after the parent directory", () => {
    const rows = [
      makeRow({ path: "/ws/src", type: "directory", expanded: true }),
      makeRow({ path: "/ws/src/index.ts", depth: 1 }),
      makeRow({ path: "/ws/README.md" }),
    ];
    const session = createWorkspaceFileTreeEditingSession({
      mode: "create-directory",
      parentPath: "/ws/src",
    });
    const injected = injectWorkspaceFileTreeDraftRow({
      rows,
      session,
      workspacePath: "/ws",
    });
    expect(injected.length).toBe(4);
    const draft = injected[1];
    expect(draft).toBeTruthy();
    expect(draft!.editing).toBe("create");
    expect(draft!.depth).toBe(1);
    expect(draft!.type).toBe("directory");
    // 草稿行紧跟父目录行，排在既有子项之前。
    expect(injected[2]?.path).toBe("/ws/src/index.ts");
  });

  it("injectWorkspaceFileTreeDraftRow is a no-op for rename sessions and missing parents", () => {
    const rows = [makeRow({ path: "/ws/src/index.ts" })];
    const renameSession = createWorkspaceFileTreeRenameSession(rows[0]!);
    expect(renameSession.mode).toBe("rename");
    expect(renameSession.targetPath).toBe("/ws/src/index.ts");
    expect(
      injectWorkspaceFileTreeDraftRow({
        rows,
        session: renameSession,
        workspacePath: "/ws",
      }),
    ).toBe(rows);
    const orphanCreate = createWorkspaceFileTreeEditingSession({
      mode: "create-file",
      parentPath: "/ws/not-loaded-yet",
    });
    expect(
      injectWorkspaceFileTreeDraftRow({
        rows,
        session: orphanCreate,
        workspacePath: "/ws",
      }),
    ).toBe(rows);
  });

  it("getWorkspaceEntryRenameSelectionEnd selects basename without extension", () => {
    expect(getWorkspaceEntryRenameSelectionEnd("index.ts")).toBe(5);
    expect(getWorkspaceEntryRenameSelectionEnd(".env")).toBe(4);
    expect(getWorkspaceEntryRenameSelectionEnd("folder")).toBe(6);
  });
});
