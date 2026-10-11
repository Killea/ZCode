# Workspace 文件树 Side Pane tab

## 背景

`WorkspaceFileTree`（`packages/ui/src/workspace-file-tree/`）此前只能作为 `WorkspaceSidebar`
内部的 slide-over 覆盖层打开，浏览目标是「被点击的那一行 workspace」，不跟随当前选中工程，
也没有主界面常驻入口。

需求：在主界面右侧提供常驻文件面板，跟随当前激活 workspace 切换，文件可拖放/添加为聊天
上下文，顶部工具栏提供图标控制显隐。

## 规则

1. `file-tree` 是 workspace-global Side Pane tab（与 `git`、`developer-tools` 同类）：
   - 单例 `id: "file-tree"`；`isSidePaneTabVisibleForParent` 默认分支返回 `true`，
     不按 parentSessionId/rootSessionId 收窄；
   - 与 Git、Terminal、Code Viewer 等 tab 并存于同一 `WorkspaceSidePaneState`。
2. tab 对象**不存储 workspace 字段**。渲染时由 `AnimatedSidePanePanel` 把 shell 传入的
   当前 `{workspacePath, workspaceIdentity, workspaceRemoteSessionId}` 交给
   `WorkspaceFileTree`——与 `GitPane` 的取值方式一致。切换工程后同一 tab 自动指向新
   workspace；`useWorkspaceFileTreeData` 内已有的 generation 递增 + watcher 重新绑定 +
   stale 结果丢弃逻辑（`useEffect` on `workspacePath/workspaceIdentity` 清空
   children/expanded/loaded/git 状态）负责隔离旧 workspace 数据，不新增第二份同步状态。
3. Header 文件图标（`FolderTree`）切换语义 = `toggleFileTreeSidePane`（复刻
   `toggleGitSidePane` 的形状）：
   - file-tree tab 激活中 → 关闭该 tab；若关闭后无 tab 则面板收起；
   - file-tree tab 存在但未激活 → 激活它；
   - 不存在 → 创建 + 激活；面板收起时同时展开（`handleRevealSidePane`）。
   - 按钮 active 态 = 面板展开且激活 tab 为 file-tree。
4. `+` 标签菜单新增 Files 项（`FolderTree` 图标），打开语义与上文创建分支一致，幂等。
5. Side Pane 内不渲染「返回任务」导航：`WorkspaceFileTree.onClose` 改为可选；Sidebar
   覆盖层仍必传，Side Pane 场景省略。
6. 文件→聊天上下文链路不变，**无需新增任何 prop**：
   - 行拖拽：`WorkspaceFileTreeRowView` 已内置 `WORKSPACE_FILE_DRAG_MIME`
     （`application/x-zcode-workspace-file`，payload 携带 workspacePath +
     workspaceIdentity + path/relativePath/type）与 `text/plain` mention 回退；
     `ConversationComposer`/`ChatPromptEditor` 的既有 drop 处理经
     `createWorkspaceFileComposerMention` 按同 workspace 生成相对路径 mention、跨
     workspace 生成绝对路径 mention；
   - 右键「Add to chat」：`dispatchWorkspaceFileAddToChat` 派发的 window 事件由
     `ConversationComposer` 既有 listener 消费；
   - `onOpenPreview` → `onOpenCodeViewer`，source 补当前 workspace 三元组（与 Sidebar
     做法一致）。
     文件树本身不写 composer 状态，不新增第二条上下文写入路径。
7. Office 模式禁止新建 file-tree tab（沿用 `toggleGitSidePane` 的 office 守卫）；
   Header 按钮在 office 模式隐藏（与 `WorkspaceTerminalToggleButton` 一致）。
   office 排除清单（recentClosed 过滤）与 `terminal`/`git` 同规则。
8. 远程 workspace：`WorkspaceFileTree` 内部经 `useWorkspaceServices` 按三元组路由到
   远端 Host；断连时组件已有「等待重连」分支，面板照常渲染该状态，不回退本地服务。
9. 最近关闭列表：file-tree tab 走通用 `closeSidePaneTab`/`reopenClosedTab` 机制，
   无额外持久化；Side Pane tab 状态本身按 workspaceKey 存入现有 memory。

## 所有者与事件顺序

```
Header FolderTree 按钮 / + 菜单
  → App.handleToggleFileTree (useAppPanels)          ← 唯一写入入口
  → updateWorkspaceSidePaneState(workspaceKey)       ← tabStore，唯一状态所有者
  → workspaceSidePane.toggleFileTreeSidePane(state)  ← 纯函数状态迁移
  → AnimatedSidePanePanel                            ← 唯一渲染入口（TabsContent case）
  → WorkspaceFileTree → useWorkspaceFileTreeData
  → useWorkspaceServices(三元组) → fileService/fileWatcherService/gitService
```

- 状态所有者：`tabStore.workspaces[workspaceKey].sidePane`（workspaceKey =
  `workspaceIdentity?.trim() || workspacePath`）。
- 展开/目录/Git 状态/搜索索引仍由 `useWorkspaceFileTreeData` 组件局部持有，不进全局 store。
- 拖放：树行 `draggable` → `DropComposer`/`createMentionFromPath` 既有链路到
  Composer mention；文件树不直接写 composer 状态。

## 验收场景

- 本地 workspace：Header 点文件图标 → 右侧出现 Files tab 并展示当前工程根目录；再点 →
  tab 关闭、面板收起；面板开着但激活别的 tab 时点图标 → 切回 Files。
- `+` 菜单选 Files → 同上创建/激活。
- 切换工程 → Files tab 内容变为新工程目录，旧工程展开态/搜索结果不残留。
- 文件行拖入 Composer → 生成与现有链路一致的 path mention（文件用 @mention，
  目录走 attachment 提示）；「Add to chat」菜单同效。
- 远程 workspace：Files 列远端目录；断开连接 → 显示等待重连分支，不读本地文件系统。
- 最近关闭列表 → Files 可恢复；office 模式 → 无入口、recentClosed 不含 file-tree。
- task 切换（同 workspace 内）→ Files tab 保留。

```

```
