# Header Running Task Indicators

## 产品规则

Workspace header 右上角功能图标区最左侧展示一排会话指示图标：运行中的会话排在前面，槽位不足时用最近会话补齐。

- **范围**：当前窗口所有打开的 workspace tab（本地 + 远程），不限于活动 workspace。
- **槽位**：固定目标 `MAX_VISIBLE = 6` 个图标。运行中会话优先占槽；不足 6 个时按 updatedAt 顺序用最近会话补齐（会话总数不足则全部显示）。最近会话不参与 `+N` 折叠——补齐槽位只是快捷入口，完整列表在侧栏。
- **运行判定**：与侧栏任务行一致——sessions-index 实时 `phase === "prewarming" | "running"`（`isTaskListRowRunning`）。不采信持久化 `status=running` 残留；`sourceAvailability === "offline"` 的远程 source 冻结快照不计入（running 与补齐都不计）。
- **等待输入**：phase 仍为 running 但有 pending interaction（权限/提问）的会话同样显示转圈，但使用 warning（橙/黄）色区分，tooltip 附等待标签。
- **图标**：运行中 = `LoaderIcon` 旋转；非运行补齐 = 静态状态点（复用 `deriveTaskLeadingIndicator`：error→destructive、unread→sky、普通→foreground-subtlest），不旋转。ghost `icon-md` 按钮；当前激活 session 用 `!bg-selected` 高亮。
- **Tooltip**：session 标题；非活动 workspace 的会话附 workspace 标签作为第二行说明；非运行补齐项附相对时间（`formatTaskRelativeTime`）说明"最近"排序依据。
- **点击**：等价于点击侧栏 session——复用 `handleSelectTaskInChat`（激活/补开 workspace tab → workbench 安置 → `setActiveTaskId` → 未读清理），远程会话透传 `remoteSessionId`。
- **折叠**：运行中会话超过 6 个时，其余收进 `+N` 按钮的 DropdownMenu，菜单项行为与图标一致。
- **空态**：整个 online active 集合为空时不渲染，不占位。
- **可见性门禁**：`simplifyForNarrowRemote`（手机远控窄头）下不挂载；`draft` 与 `task` 两种 header variant 都显示。

## 状态所有权

- 数据权威：Window Host Controller 投影（Host 内存），renderer 经 `useGlobalTaskList({kind:"active"})` + `windowControllerTaskListRegistry` 共享订阅读取；组件不另存第二份 running 集合。
- 导航权威：`handleSelectTaskInChat`（WorkspaceShellLayout），与侧栏行点击同一条链路，不复制导航逻辑。

## 接口

```ts
// WorkspaceHeaderActionSectionProps 新增
onSelectTask?: (
  workspacePath: string,
  taskId: string,
  workspaceIdentity?: string,
  remoteSessionId?: string,
) => void;
```

新组件 `WorkspaceRunningTaskIndicators`（packages/ui/src/）：自取 `useTabStore` 的 workspace tabs + `useGlobalTaskList`。挂载门禁在 `WorkspaceHeaderActionSection`：`!simplifyForNarrowRemote && onSelectTask`，无回调（如单测、Storybook 裸渲染）时整个组件不挂载，避免空跑 Controller 查询。

## 验收场景

1. 启动一个会话发消息 → header 出现转圈图标，tooltip 为会话标题；点击跳回该会话。
2. 两个 workspace 各跑一个会话 → 两个图标；非当前 workspace 的图标 tooltip 带 workspace 标签，点击切 tab 并选中会话。
3. 会话等待权限确认 → 图标变 warning 色转圈。
4. 7+ 会话同时运行 → 前 6 个图标 + `+N` 折叠按钮，菜单项可点击跳转。
5. 部分会话停止 → 空出的槽位由最近会话静态点补齐，始终维持 6 个（会话总数足够时）。
6. 全部会话停止 → 显示最近 6 个会话的静态点图标，点击照常跳转。
7. 远程 workspace 断连（offline）→ 其会话既不计为 running，也不参与补齐。
8. 未读/出错的最近会话 → 静态点分别为 sky/destructive 色。

## 验证记录

- `packages/ui/test/headerRunningTaskIndicators.test.ts`：纯函数单测（running 优先占槽 + 最近会话补齐至 6 槽、running 超额进 overflow、offline 双向排除、waiting 判定）。
- `packages/ui/test/browser/manual-review/pending/header-running-tasks.test.mjs`：vite + Playwright 真浏览器验证四场景——默认（8 running → 6 转圈 + "+2"、激活态 `bg-selected`、等待态 `text-warning`、折叠菜单导航）、backfill（2 running → 2 转圈 + 4 状态点补满、unread 蓝点/error 红点、tooltip 标题+相对时间、点击透传）、sparse（0 running → 3 静态点）；1200/en-US/dark 与 390/zh-CN/light 矩阵通过，截图存 artifacts。
- `pnpm typecheck` 0 错误；`pnpm lint` 62 存量警告（与改动无关）；`pnpm architecture:check --changed` 0 违规；`fmt:check` 仅 vendored Electron 文档 HTML 存量失败。
- 未执行项：真 Electron E2E（需要真实 agent 运行会话）；preview 构建需按仓库规则先 push。
