# 项目内置顶（project-scoped task pinning）

## 背景与问题

侧栏"项目"视图（`taskViewMode === "workspace"`，默认的项目→任务分组织视图）中，置顶一个任务会把该任务从项目任务列表里移除，统一渲染进侧栏顶部的全局"已置顶"区（`WorkspacePinnedTasksSection`）。该区跨所有项目聚合置顶任务——多工程混在一起，且任务离开了自己的项目上下文，难以定位。

**目标**：在项目视图下，置顶任务停留在**自己所属项目的任务列表顶部**；全局"已置顶"区在该模式下不再渲染。

## 关键事实（决定方案形态）

- **持久化本就按 workspace 作用域**：`pinned` 归属存在每个 endpoint 自己的 `tasks-index`（`listPinnedTasks({workspacePath, workspaceIdentity})`），本地与远程同构。"跨项目混合"只是渲染层聚合，不是数据模型问题——**无需协议/存储迁移**。
- 每个 workspace 任务组的构建是 renderer 侧投影（`buildWorkspaceGroupsFromSessions`）：`taskIndexItems` 已包含 active+pinned+archived 三分区并集，`kind:"timeline"`（`!pinned && !archived`）把 pinned 行过滤掉。
- 查询缓存的 membership 判定 `matchesTaskMembership` 把 `"workspace"` descriptor 映射为 `"timeline"`——这是 pin/unpin 乐观 mutation 把行踢出项目查询缓存的原因。
- `ZCodeTaskListKind` 的 `"active"` 归属 = `!archived`，天然包含 pinned 行；协议无需改动。

## 产品规则

1. **workspace（项目）视图**：
   - 每个项目的任务列表包含其全部未归档任务；**置顶任务稳定排在列表最前**，pin 徽标（isPinned）点亮。
   - 置顶/非置顶各自分区内部仍按当前 `taskSortBy`（manual/created/updated）排序——pin 只决定分区，不重排分区内部。
   - 全局"已置顶"区在该视图下不渲染（项目列表已是置顶任务的唯一展示面）。
   - 置顶任务的未读计入项目行的未读徽标；置顶任务永远不被 `visibleLimit`/"显示更多"折叠（分区在分页截断之前完成）。
   - pin/unpin 乐观更新：行**留在原项目内**并立刻移动到分区边界；RPC 失败回滚到原归属，toast 报错不变。
2. **timeline / archived / grouped 视图**：完全不变——主体列表仍过滤 pinned，全局"已置顶"区继续渲染（是这些视图唯一的置顶展示面）。grouped 视图依赖该区的注释约束保持成立。
3. **archived+pinned 任务**：归属不变（`pinned && !archived` → pinned 分区；`archived` → archived 列表）。归档中的任务不出现在项目主列表；取消归档后按 pinned 状态回到项目顶部或常规位置。
4. **远程 workspace**：远端 `tasks-index` 的 `listPinnedTasks` 经同一 endpoint shard 参与 `taskIndexItems`，远端置顶任务同样出现在远端项目列表内；`useRemotePinnedTaskStore`/`useRemoteTimelineTaskStore` 的乐观搬运只服务 timeline/pinned 视图，保持不变。

## 状态所有者与数据流

```
tasks-index (pinned flag, per endpoint)          ← 唯一真相源，不改动
  └─ fetchTaskListMembershipSetsForEndpointsCached  (taskIndexItems ⊇ pinned; pinnedIds)
       └─ buildWorkspaceGroupsFromSessions          kind "timeline"→"active"；按 pinnedIds 稳定分区
            │  group.items        = [...pinnedItems, ...regularItems]   (分页截断前)
            │  group.pinnedTaskKeys = 置顶成员的 entityKey 集合          (新增，仿 unreadTaskKeys)
            ├─ slice(0, visibleLimit) → setQueryResults → CachedTaskListResult
            │     ├─ taskKeys        已按 pinned-first 排序
            │     └─ pinnedTaskKeys  分页前的完整置顶成员（新字段）
            ├─ applyTaskMutation    "workspace"→"active"；维护 pinnedTaskKeys；workspace 排序 pinned-first
            ├─ preserveFreshLocalTaskKeys / removeTask 同步维护该字段
            └─ buildWorkspaceTaskListDisplayGroups → WorkspaceTaskListGroup.pinnedTaskIds
                 └─ WorkspaceSidebar → SortableWorkspaceSidebarItem → WorkspaceSidebarItem
                      └─ TaskList: pinnedTasks=组内置顶子集 → pinnedTaskIdSet(徽标) + 渲染分区置顶
```

## 改动边界

- `useWorkspaceTaskLists.ts`：`buildWorkspaceGroupsFromSessions` 用 `kind:"active"` 构建 + 稳定分区；组结果携带 `pinnedTaskKeys`；`WorkspaceTaskListGroupResult`/`setQueryResults` 入口同步。
- `taskQueryCache.ts`：`CachedTaskListResult.pinnedTaskKeys?`（workspace 查询专用，语义同 `unreadTaskKeys`）。
- `taskQueryCacheStore.ts`：`"workspace"`→`"active"`；`pinnedTaskKeys` 在 `buildCachedTaskListResult`/`isQueryResultEquivalent`/`setQueryResult(s)`/`applyTaskMutation`/`removeTask`/`preserveFreshLocalTaskKeys` 全链路维护；`sortTaskKeysByDescriptor` 支持 pinned-first 分区（仅 workspace descriptor）。
- `workspaceTaskListDisplayGroups.ts`：`WorkspaceTaskListGroup.pinnedTaskIds` + 等价比较。
- `WorkspaceSidebar.tsx`：`shouldShowPinnedTasks` 排除 `"workspace"` 模式；组 `pinnedTaskIds` 下传。
- `SortableWorkspaceSidebar.tsx` / `WorkspaceSidebarItem.tsx`：`taskPinnedTaskIds` 透传；`pinnedTasks` 由 `taskItems ∩ pinnedIds` 过滤（不再恒空）。
- `TaskList.tsx`：`visibleSourceTasks` 排序后按 `pinnedTaskIdSet` 稳定分区——三排序模式下置顶恒在最前，同时兜住乐观合并窗口内的顺序。
- **不改**：`setTaskPinned`/`listPinnedTasks` 协议与存储；`WorkspacePinnedTasksSection` 本体及其在非项目视图的渲染；timeline/grouped/archived 视图语义；远程 store。

## 验收场景

- [ ] 项目 A 内置顶任务 → 留在项目 A 任务列表顶部、pin 徽标点亮；不出现在项目 B；侧栏无"已置顶"区。
- [ ] 项目内取消置顶 → 任务回到常规排序位置；全局区（切到 timeline 视图）不再包含它。
- [ ] 多项目各有置顶 → 各自列表互不串扰（workspaceIdentity 隔离，含同路径不同远端会话）。
- [ ] 项目内 pin 图标的乐观跳位：点击后该行立刻到项目顶部；RPC 失败回滚。
- [ ] 项目任务数 > visibleLimit 时，置顶任务不被"显示更多"折叠。
- [ ] 切到 timeline/archived/grouped 视图 → 全局"已置顶"区照常渲染。
- [ ] 归档一个置顶任务 → 从项目列表消失（出现在归档视图）；取消归档 → 回到项目顶部。
- [ ] 远程 workspace 的置顶任务出现在其项目列表内。

## 已知未覆盖

- `taskListE2EActions` 的 membershipKinds 诊断：置顶任务现在同时出现在 `workspace` 与 `pinned` 两类缓存查询中（原先只在 `pinned`）——若 e2e 断言"置顶后不在 workspace 缓存"需同步更新；本仓库当前无该断言的可执行入口。
- `mergeWorkspaceTaskListItemsWithOptimistic` 对乐观草稿按 sortBy 重排会短暂打乱 pinned-first——`TaskList` 渲染层分区兜底，且草稿任务不可能为 pinned。
