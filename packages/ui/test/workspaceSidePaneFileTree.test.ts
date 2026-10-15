import { describe, expect, it } from "vitest";
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

describe("workspaceSidePane file-tree", () => {
  it("activateFileTreeSidePane 从空状态创建单例 file-tree tab 并激活", () => {
    const next = activateFileTreeSidePane(null);
    expect(next.tabs.length).toBe(1);
    expect(next.activeTabId).toBe("file-tree");
    expect(next.tabs.map((tab) => tab.type)).toEqual(["file-tree"]);
  });

  it("activateFileTreeSidePane 幂等：重复激活不复制 tab", () => {
    const once = activateFileTreeSidePane(null);
    const twice = activateFileTreeSidePane(once);
    expect(twice.tabs.length).toBe(1);
    expect(twice.activeTabId).toBe("file-tree");
  });

  it("activateFileTreeSidePane 保留既有 tab 并把 file-tree 激活", () => {
    const next = activateFileTreeSidePane(createTerminalState());
    expect(next.tabs.length).toBe(2);
    expect(next.activeTabId).toBe("file-tree");
    expect(next.tabs.some((tab) => tab.id === "terminal:1")).toBeTruthy();
  });

  it("toggleFileTreeSidePane：file-tree 激活时关闭它；否则激活", () => {
    const opened = toggleFileTreeSidePane(createTerminalState());
    expect(opened).toBeTruthy();
    expect(opened!.activeTabId).toBe("file-tree");

    const closed = toggleFileTreeSidePane(opened);
    // file-tree 是唯一被关闭的 tab，剩余 terminal tab 继续存活。
    expect(closed).toBeTruthy();
    expect(closed!.tabs.map((tab) => tab.id)).toEqual(["terminal:1"]);

    const onlyFileTree = activateFileTreeSidePane(null);
    // 关掉最后一个 tab 时整个面板状态归 null（收起）。
    expect(toggleFileTreeSidePane(onlyFileTree)).toBe(null);
  });

  it("file-tree 是 workspace-global：不随 owner/parent 收窄", () => {
    const state = stampSidePaneTabsOwnership(
      activateFileTreeSidePane(createTerminalState()),
      {
        ownerTaskId: "task-a",
        workspaceKey: "ws-1",
      },
    )!;
    const fileTreeTab = state.tabs.find((tab) => tab.type === "file-tree");
    expect(fileTreeTab).toBeTruthy();
    expect(isSidePaneTabVisibleForParent(fileTreeTab!, "task-other")).toBe(
      true,
    );
    expect(isSidePaneTabVisibleForParent(fileTreeTab!, null)).toBe(true);

    const visibleForOtherOwner = getVisibleSidePaneTabs(state.tabs, {
      workspaceKey: "ws-1",
      ownerTaskId: "task-other",
    });
    expect(visibleForOtherOwner.map((tab) => tab.type)).toEqual(["file-tree"]);
  });

  it("file-tree 匹配 workspaceKey：异 workspace scope 下不可见", () => {
    const state = stampSidePaneTabsOwnership(
      activateFileTreeSidePane(createTerminalState()),
      {
        ownerTaskId: "task-a",
        workspaceKey: "ws-1",
      },
    )!;
    const visibleForOtherWorkspace = getVisibleSidePaneTabs(state.tabs, {
      workspaceKey: "ws-2",
      ownerTaskId: "task-a",
    });
    expect(visibleForOtherWorkspace.length).toBe(0);
  });

  it("task 切换后 file-tree tab 保留且仍可激活", () => {
    const state = stampSidePaneTabsOwnership(
      activateFileTreeSidePane(createTerminalState()),
      {
        ownerTaskId: "task-a",
        workspaceKey: "ws-1",
      },
    )!;
    const resolved = resolveSidePaneScopeState(state, {
      workspaceKey: "ws-1",
      ownerTaskId: "task-b",
    });
    expect(resolved.sidePaneState).toBeTruthy();
    expect(resolved.sidePaneState!.activeTabId).toBe("file-tree");
    expect(resolved.isSidePaneCollapsed).toBe(false);
  });

  it("closeSidePaneTab / restoreSidePaneTab 对 file-tree 走通用路径", () => {
    const opened = activateFileTreeSidePane(null);
    const fileTreeTab = opened.tabs[0]!;
    const closed = closeSidePaneTab(opened, "file-tree");
    expect(closed).toBe(null);

    const restored = restoreSidePaneTab(closed, fileTreeTab);
    expect(restored.activeTabId).toBe("file-tree");
    expect(getActiveSidePaneTab(restored)?.type).toBe("file-tree");
  });
});
