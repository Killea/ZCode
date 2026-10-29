# Header Running Task Indicators

## 产品规则

Workspace header 右上角功能图标区最左侧展示一排"正在执行中"的会话指示图标。

- **范围**：当前窗口所有打开的 workspace tab（本地 + 远程），不限于活动 workspace。
- **运行判定**：与侧栏任务行一致——sessions-index 实时 `phase === "prewarming" | "running"`（`isTaskListRowRunning`）。不采信持久化 `status=running` 残留；`sourceAvailability === "offline"` 的远程 source 冻结快照不计入。
- **等待输入**：phase 仍为 running 但有 pending interaction（权限/提问）的会话同样显示转圈，但使用 warning（橙/黄）色区分，tooltip 附等待标签。
- **图标**：`LoaderIcon` 旋转，ghost `icon-md` 按钮；当前激活 session 用 `!bg-selected` 高亮。
- **Tooltip**：session 标题；非活动 workspace 的会话附 workspace 标签作为第二行说明。
- **点击**：等价于点击侧栏 session——复用 `handleSelectTaskInChat`（激活/补开 workspace tab → workbench 安置 → `setActiveTaskId` → 未读清理），远程会话透传 `remoteSessionId`。
- **折叠**：最多直接显示 `MAX_VISIBLE = 6` 个；其余收进 `+N` 按钮的 DropdownMenu，菜单项行为与图标一致。
- **空态**：无 running 会话时不渲染，不占位。
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
5. 会话结束 → 图标消失；全部结束 → 整条隐藏。
6. 远程 workspace 断连（offline）→ 其会话不再计为 running。

## 验证记录

- `packages/ui/test/headerRunningTaskIndicators.test.ts`：纯函数单测（running 过滤、offline 排除、waiting 判定、MAX_VISIBLE 切分）。
- `packages/ui/test/browser/manual-review/pending/header-running-tasks.test.mjs`：vite + Playwright 真浏览器验证（8 running → 6 直显 + "+2" 折叠、激活态 `bg-selected`、等待态 `text-warning`、tooltip 会话名、点击透传 workspace/identity/remoteSessionId、折叠菜单项导航、390px 无横向溢出；1200/en-US/dark 与 390/zh-CN/light 两矩阵通过，截图存 artifacts）。
- `pnpm typecheck` 0 错误；`pnpm lint` 62 存量警告（与改动无关）；`pnpm architecture:check --changed` 0 违规；`fmt:check` 仅 4 个 vendored Electron 文档存量失败。
- 未执行项：真 Electron E2E（需要真实 agent 运行会话）；preview 构建需按仓库规则先 push。
