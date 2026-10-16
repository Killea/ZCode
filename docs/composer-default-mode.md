# Composer 缺省权限模式（默认模式设置项）

## 背景与目标

新任务的初始权限模式现状是：

```
composer 草稿种子（newTaskDraft.initializeNewTaskDraft）
  = recent?.mode（本 workspace 最近一次被接纳提交，localStorage）?? "build"
```

- `recent` 按 workspaceKey 隔离（`zcode-model-selection-recent-v1:<workspaceKey>`），
  是"最近一次显式意图"的继承；
- 无 recent 时硬编码回落 `"build"`（变更前确认）——这是上游官方的缺省行为；
- 运行时 `resolveExecutionState`（`packages/shared/src/execution-state.ts`）的缺省同样是 `build`。

ZCodePlus fork 的目标：把"无 recent 时的兜底"从硬编码 build 升级为**用户可调的全局设置项
「默认模式」**，且 fork 缺省值直接取「完全访问」（yolo）——新用户装好即用完全访问起稿，
不再默认逐次确认。这是与官方版本的行为差异，README 差异清单需同步。

## 产品规则

1. **设置项**：AppSettings 全局字段 `defaultSessionMode`，值域为 composer 可切换的权限档
   `build / edit / guarded / yolo`。`plan` 是独立勾选（阻止一切编辑），`auto` 是内部保留值，
   都不做缺省候选。
2. **种子优先级**（新任务 composer 草稿）：
   `recent?.mode`（最近一次显式提交，per workspace） > `defaultSessionMode`（全局设置） > `build`。
   设置项**不得**覆盖 recent——recent 是更新的显式意图。
3. **fork 缺省**：`DEFAULT_ZCODE_DEFAULT_SESSION_MODE = "yolo"`。
   字段缺失（新装 / 旧版本设置文件 / 读取失败）一律按该常量起稿；用户显式改回 build 时尊重设置。
4. **只影响新任务起稿**：
   - 已有会话的 `mode.current` 快照、会话中途切换（`switchCollaborationMode`）路径零变化；
   - resume 模式取自历史（`derivePersistedSessionMode` / create-resume 参数），不参与设置项；
   - `edit` 历史值不在设置页候选（与 composer 菜单"隐藏 Edit 不等于删除历史值"同口径），
     但 schema 仍接受，种子直接采用。
5. **零协议变更**：mode 本就由草稿 → v4 `createSession` 的 `config.mode` → runtime 显式携带，
   本功能只替换"无 recent 时的兜底来源"。desktop-continuous 与 web-remote-replayable 两条链路
   无新字段、无新事件。
6. **手机远控**：桥接后 web 页面的 `settingService` 是到桌面 Host 的 ProxyChannel
   （`packages/client/src/remoteServiceAccess.ts`），`useSettings()` 读到同一份 AppSettings，
   同一份 `Root` composer 代码自动获得相同的缺省模式；未桥接 home 态的 stub 无该字段 → 按
   fork 缺省（yolo）起稿，home 态无发送能力，无实际影响。
7. **非交互路径 v1 不变**：bots 建会话不带 mode → 运行时 build（群聊场景安全保留）；
   off-peak 有自己的每任务模式选择；纯 CLI 不变。若将来要覆盖，再扩
   `zcodeSessionRuntimePreferencesResultSchema`，独立立项。

## 状态 owner

| 状态                                   | Owner                                                        | 生命周期                                          |
| -------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------- |
| `defaultSessionMode`                   | AppSettings（`settingService` 持久化，Host 所有）             | 设置页写入持久化；renderer 只读；广播经既有通道   |
| recent 模式                            | renderer localStorage（per workspaceKey，`composerRecent.ts`）| 最近一次被接纳提交覆盖                            |
| 新任务草稿 `draft.mode`                | `V4ComposerDraft`（`composerDraftStore.ts`）                  | 种子写入即用户意图标记；后续 snapshot 不得回填    |
| 会话运行模式                           | runtime `ExecutionState`（`agent-runtime.ts`）                | create 参数 / `setExecutionState` 切换             |

## 接口

### shared（`packages/shared`）

- `execution-state.ts` 新增：

  ```ts
  export const zcodeDefaultSessionModeSchema = z.enum(["build", "edit", "guarded", "yolo"]);
  export type ZCodeDefaultSessionMode = z.infer<typeof zcodeDefaultSessionModeSchema>;
  export const DEFAULT_ZCODE_DEFAULT_SESSION_MODE: ZCodeDefaultSessionMode = "yolo";
  ```

- `protocol.ts`：`AppSettings.defaultSessionMode?: ZCodeDefaultSessionMode`。
- `validationAppSettings.ts`：
  - 读取侧用 `zcodeDefaultSessionModeSchema.optional().catch(undefined)`
    （与 `dynamicWorkflowModeSettingSchema` 同口径）：未知值（新版本写入 / 手改）只把**本字段**
    降级为缺省，不能因一个偏好字段让整份设置回落 `defaultSettings()`
    （`settingService.readSettingsWithMeta` 对 schema 校验失败是整份回落）。
  - patch 侧 `zcodeDefaultSessionModeSchema.optional()`。

### UI（`packages/ui`）

- `v4/composer/newTaskDraft.ts`：`initializeNewTaskDraft` 增加
  `defaultSessionMode?: ZCodeDefaultSessionMode` 参数，种子改为
  `recent?.mode === "plan" ? "build" : (recent?.mode ?? defaultSessionMode ?? "build")`。
- `v4/composer/useDraftConfigControl.ts`：
  - 新任务种子条件在原「`modelSelectionView` 就绪」之外，加「settings 已解析」
    （`sharedSettings !== null || !settingsLoading`）：设置项参与种子，抢跑会把
    预设置加载的回退值固化进草稿（草稿是意图标记，后续 snapshot 不回填）；
    读取失败（loading=false 且 settings=null）按 fork 缺省起稿。
  - 传入 `sharedSettings?.defaultSessionMode ?? DEFAULT_ZCODE_DEFAULT_SESSION_MODE`。
- 设置页（General → Agent 行为组卡，`zcodeInteractionBehavior` 行之前）：
  「默认模式」Select 行；候选 = `getZCodeAgentAvailableModes()` 去掉 `plan`
  （build / guarded / yolo，与 composer 权限单选同构）；文案复用 `mode.label.glm.{value}`；
  当前值解析为 `sharedSettings?.defaultSessionMode ?? DEFAULT_ZCODE_DEFAULT_SESSION_MODE`
  （不引入本地镜像 state，直接随 sharedSettings 重渲）。
- 遥测：`SETTINGS_USER_ACTION_FEATURES["settings.conversation"]` 增
  `change_default_session_mode`（settings 组叶子 47 → 48，同步
  `userActionTraceCatalog.test.ts` 断言）。

## 边界与事件顺序

```
用户设置页改「默认模式」
  → updateSharedSettings({ defaultSessionMode })（持久化 + platform.syncAppSettings + 刷新）
  → 下一次新任务：useDraftConfigControl 种子读 settings（桌面直读 / 手机 ProxyChannel 读）
  → 首发 createSession config.mode 携带（既有路径，零变化）
  → runtime resolveExecutionState 固定本会话模式
```

- 已有会话 / resume：模式与现状一致，设置项不参与。
- 修改设置不影响**已存在**的草稿（草稿已有 mode 时种子不重跑）——语义与模型 Recent 一致：
  设置只约束"还没有意图"的新任务。

## i18n / a11y / testid

- `settings.defaultSessionMode`、`settings.defaultSessionModeDescription`（zh-CN / en-US）；
  选项文案复用 `mode.label.glm.{value}`，不新增模式文案。
- testid：`settings-default-session-mode-select`。

## 不做（明确边界）

- 不动 session runtime preferences 协议（bots / off-peak / CLI 不继承该设置，见产品规则 7）。
- 不做 workspace 级默认模式（v1 全局）。
- 不让设置覆盖 recent。
- 不改 `resolveExecutionState` 运行时缺省（仍 build）——缺省上移只在 UI 种子层。

## 验收场景

1. 全新安装、从未提交：新任务 composer 显示「完全访问」，首发会话以 yolo 运行。
2. 同 workspace 曾以 build 提交：新任务显示「变更前确认」（recent 优先于设置）。
3. 设置页改为「变更前确认」：此后无 recent 的 workspace 新任务回落 build。
4. 改回「完全访问」：无 recent 新任务恢复 yolo。
5. 已有会话显示与实际模式不受设置影响；resume 模式保持历史值。
6. settings.json 手写未知值（如 `"auto"`）：整份设置不回落，本字段降级缺省，
   新任务按 fork 缺省（yolo）起稿，设置页显示「完全访问」。
7. 手机远控（桥接态）新任务：起稿模式与桌面设置一致。
8. 设置页 Select 显示当前值；切换立即持久化并在刷新后保持。

## 验证计划

- 单测：
  - `packages/ui/test/`：`initializeNewTaskDraft` 优先级矩阵
    （无 recent+设置 / 无 recent+缺省 / recent 覆盖设置 / plan recent 归一 / edit 设置值透传）；
  - `packages/shared/test/appSettings.test.ts`：读取侧缺省与 catch 语义、patch 侧值域、
    未知值不拖垮整份设置。
- `pnpm typecheck` / `pnpm lint` / 目标 vitest；随后本机 + Mac 全链重建并验证产物。
- E2E：仓库无 E2E 基建；按验收场景 1–8 手动验证。
