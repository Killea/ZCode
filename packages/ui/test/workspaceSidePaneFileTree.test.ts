import assert from "node:assert/strict";
import test from "node:test";
import {
  activateFileTreeSidePane,
  closeSidePaneTab,
  getActiveSidePaneTab,
  getVisibleSidePaneTabs,
  isSidePaneTabVisibleForParent,
  resolveSidePaneScopeState,
  restoreSidePaneTab,
  stampSidePaneTabsOwnership,
  toggleFileTreeSidePane,
  type WorkspaceSidePaneState,
} from "../src/lib/workspaceSidePane.js";

// App 层 commitOpenedSidePaneState 在写入时统一冻结归属；测试里同样显式打标，
// 保持与生产路径一致（workspaceKey 缺失的 tab 会被视为跨 workspace 可见）。
function createTerminalState(): WorkspaceSidePaneState {
  return stampSidePaneTabsOwnership(
    {
      tabs: [
        {
          id: "terminal:1",
          type: "terminal",
          title: "Terminal 1",
        },
      ],
      activeTabId: "terminal:1",
    },
    { ownerTaskId: "task-a", workspaceKey: "ws-1" },
  )!;
}

test("activateFileTreeSidePane 从空状态创建单例 file-tree tab 并激活", () => {
  const next = activateFileTreeSidePane(null);
  assert.equal(next.tabs.length, 1);
  assert.equal(next.activeTabId, "file-tree");
  assert.deepEqual(
    next.tabs.map((tab) => tab.type),
    ["file-tree"],
  );
});

test("activateFileTreeSidePane 幂等：重复激活不复制 tab", () => {
  const once = activateFileTreeSidePane(null);
  const twice = activateFileTreeSidePane(once);
  assert.equal(twice.tabs.length, 1);
  assert.equal(twice.activeTabId, "file-tree");
});

test("activateFileTreeSidePane 保留既有 tab 并把 file-tree 激活", () => {
  const next = activateFileTreeSidePane(createTerminalState());
  assert.equal(next.tabs.length, 2);
  assert.equal(next.activeTabId, "file-tree");
  assert.ok(next.tabs.some((tab) => tab.id === "terminal:1"));
});

test("toggleFileTreeSidePane：file-tree 激活时关闭它；否则激活", () => {
  const opened = toggleFileTreeSidePane(createTerminalState());
  assert.ok(opened);
  assert.equal(opened.activeTabId, "file-tree");

  const closed = toggleFileTreeSidePane(opened);
  // file-tree 是唯一被关闭的 tab，剩余 terminal tab 继续存活。
  assert.ok(closed);
  assert.deepEqual(
    closed.tabs.map((tab) => tab.id),
    ["terminal:1"],
  );

  const onlyFileTree = activateFileTreeSidePane(null);
  // 关掉最后一个 tab 时整个面板状态归 null（收起）。
  assert.equal(toggleFileTreeSidePane(onlyFileTree), null);
});

test("file-tree 是 workspace-global：不随 owner/parent 收窄", () => {
  const state = stampSidePaneTabsOwnership(activateFileTreeSidePane(createTerminalState()), {
    ownerTaskId: "task-a",
    workspaceKey: "ws-1",
  })!;
  const fileTreeTab = state.tabs.find((tab) => tab.type === "file-tree");
  assert.ok(fileTreeTab);
  assert.equal(isSidePaneTabVisibleForParent(fileTreeTab, "task-other"), true);
  assert.equal(isSidePaneTabVisibleForParent(fileTreeTab, null), true);

  const visibleForOtherOwner = getVisibleSidePaneTabs(state.tabs, {
    workspaceKey: "ws-1",
    ownerTaskId: "task-other",
  });
  assert.deepEqual(
    visibleForOtherOwner.map((tab) => tab.type),
    ["file-tree"],
  );
});

test("file-tree 匹配 workspaceKey：异 workspace scope 下不可见", () => {
  const state = stampSidePaneTabsOwnership(activateFileTreeSidePane(createTerminalState()), {
    ownerTaskId: "task-a",
    workspaceKey: "ws-1",
  })!;
  const visibleForOtherWorkspace = getVisibleSidePaneTabs(state.tabs, {
    workspaceKey: "ws-2",
    ownerTaskId: "task-a",
  });
  assert.equal(visibleForOtherWorkspace.length, 0);
});

test("task 切换后 file-tree tab 保留且仍可激活", () => {
  const state = stampSidePaneTabsOwnership(activateFileTreeSidePane(createTerminalState()), {
    ownerTaskId: "task-a",
    workspaceKey: "ws-1",
  })!;
  const resolved = resolveSidePaneScopeState(state, {
    workspaceKey: "ws-1",
    ownerTaskId: "task-b",
  });
  assert.ok(resolved.sidePaneState);
  assert.equal(resolved.sidePaneState.activeTabId, "file-tree");
  assert.equal(resolved.isSidePaneCollapsed, false);
});

test("closeSidePaneTab / restoreSidePaneTab 对 file-tree 走通用路径", () => {
  const opened = activateFileTreeSidePane(null);
  const fileTreeTab = opened.tabs[0]!;
  const closed = closeSidePaneTab(opened, "file-tree");
  assert.equal(closed, null);

  const restored = restoreSidePaneTab(closed, fileTreeTab);
  assert.equal(restored.activeTabId, "file-tree");
  assert.equal(getActiveSidePaneTab(restored)?.type, "file-tree");
});
