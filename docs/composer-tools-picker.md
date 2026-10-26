# Composer MCP/插件选择器（Tools Picker）

## 背景与目标

Composer 需要一个显式入口让用户为**下一条消息**勾选推荐使用的能力（插件 / 独立 MCP 服务器）。
仓库已存在「@ 插件 mention → `plugin://` 链接 → runtime 注入能力 reminder」的完整链路
（`plugin-reference/references.ts` + `reminder.ts`），该 reminder 本身就是
"推荐但不强制"语义：它列出插件的 live skills / MCP servers / subagents，由 agent 自行决定是否使用。
本功能是该语义的 checkbox 化入口，并把覆盖范围扩到独立 MCP 服务器（纯文本引导）。

## 产品规则

1. **默认空选，走默认逻辑**：未勾选任何条目时，提交路径与现状完全一致（零 prompt 变化、
   零协议字段变化）。
2. **多选 checkbox 下拉**：工具行新增 `MCP & 插件` 按钮，展开两个分组：
   - `Plugins`：当前 authority 下 enabled 的插件条目。
   - `MCP servers`：当前 workspace 范围内 enabled 的独立 MCP 服务器
     （`zcodeagentmcp` 来源；插件自带的 MCP 不单独列出，随所属插件行覆盖）。
3. **推荐而非强制**：勾选仅在提交文本尾部追加一段「推荐能力」块；
   agent 可忽略，文案必须明确 advisory 语义。
4. **逐条 opt-in，发送后复位**：与 `includeGlobalMemory` 同语义——
   选择只影响下一条消息；发送成功后自动清空，下一条默认不选；
   `blocked` / `confirmationRequired` 路径保留选择供用户重试。
5. **失效条目静默丢弃**：发送那一刻按最新 catalog/store 解析，
   已禁用/已卸载/冲突的条目不写入提示块（插件侧 runtime reminder 也会 fail-closed 二次过滤）。

## 状态 owner

| 状态                                            | Owner                                       | 生命周期                                                                            |
| ----------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------- |
| 勾选集合 `selectedToolIds: ReadonlySet<string>` | `ConversationComposer` 组件态（`useState`） | 发送成功复位；组件卸载丢弃；不写入 `V4ComposerDraft`（与 `globalMemoryOptIn` 一致） |
| 插件目录                                        | `usePluginReferenceCatalog` 现有 hook       | `enabled = pickerOpen`，懒加载；authority 由 hook 裁决                              |
| MCP 列表                                        | `useMcpStore`                               | App 级 `useEnsureWorkspaceMcpLoaded` 已按 workspace 加载；组件只读                  |
| 提示块文本                                      | 提交时即时构建，不存状态                    | 随 `promptText` 发送                                                                |

条目标识：`plugin:{stableId}`（`name@marketplace`，协议内唯一）与 `mcp:{serverId}`（store id，跨 scope 唯一）。

## 数据源与 authority

### Plugins — `usePluginReferenceCatalog`

复用现有 hook，**不新建目录**：

```ts
usePluginReferenceCatalog(workspacePath, workspaceIdentity, sessionId, pickerOpen, {
  preferredRemoteSessionId: remoteSessionId,
});
```

- `sessionId === null`（草稿）→ `authority: "workspace"` 当前目录；
  已有 session → session 创建时冻结的 catalog（不会推荐 session 没有的能力）。
- 远程 workspace：经 `remoteSessionId` 路由，runtime 重启有代次防护。
- 条目：`pluginId`、`name`、`displayName(I18n)`、`description(I18n)`、`icon`、`enabled`、
  `conflictingPluginIds`、`skillQualifiedNames`、`mcpServerNames`、`subagentNames`。
- 只列 `enabled === true`；`conflictingPluginIds` 非空的条目可见但禁选，展示冲突原因
  （沿用 mention provider 的 V1 fail-closed 语义）。

### MCP servers — `useMcpStore`

```ts
servers: ZCodeMcpServer[]  // name/enabled/status/toolCount/scope/source/error/config
enabledStates: Record<string, boolean>
```

过滤规则与 `getEnabledMcpServersForZCode` 一致：
`enabled && source === "zcodeagentmcp" && (scope !== "workspace" || projectPath === currentProjectPath)`。

已知局限：对已有 session，该列表反映的是**当前配置**而非 session 启动时冻结的 MCP 集合；
由于 MCP 提示只是文本引导（工具实际注册集由 session 决定），可接受，不引入 session MCP 快照查询。

## UI 设计

新组件 `packages/ui/src/v4/composer/V4ComposerToolsPicker.tsx`，
挂进 `leadingActionsNode`（`V4ComposerGlobalMemorySwitch` 之后、`V4ComposerCuaEntry` 之前）。

### 触发按钮

- `Button variant="ghost" size="sm"` + `Puzzle` 图标（lucide）；
  与模式按钮同款的折叠优先级 `data-composer-collapse-priority="3"`。
- 无选择：图标 + 标签 `工具`；有选择：图标 + `N` 计数徽标（高亮态，参照
  `V4ComposerGlobalMemorySwitch` 的 checked 配色）。
- `aria-label`、tooltip（`ControlHintTooltip`）说明"为下一条消息推荐使用的能力"。
- **按钮始终渲染**：插件目录是懒加载（菜单打开才查询），渲染按钮前无法判定空；
  两个分组均无条目时菜单内各自显示空态行，而不是隐藏入口。

### 下拉内容

`DropdownMenuContent side="top" sideOffset={4}`，`w-72`，`max-h-[320px]` 内部滚动。

```
┌──────────────────────────┐
│ Plugins                  │  DropdownMenuLabel
│ ☑ context7-official  ⓘ   │  icon + displayName + 一行描述
│ ☐ figma             ⓘ    │
│ ☐ plugin-x（冲突）    ⓘ   │  disabled + 原因
│ MCP servers              │  DropdownMenuLabel
│ ☑ filesystem        ⓘ    │  名称 + 状态徽章（connected/error）
│ ☐ sentry            ⓘ    │
├──────────────────────────┤
│ 已选 3 项          清除   │  仅在选择非空时显示
└──────────────────────────┘
```

- 行：`DropdownMenuCheckboxItem`，`onSelect={(e) => e.preventDefault()}`
  保持菜单开启支持多选；行内容复用 `PluginMentionOptionContent` 的视觉结构
  （icon + 名称 + 一行描述）。
- **hover/聚焦详情**：条目 hover 时经 `ControlHintTooltip`/`HoverCard` 展示：
  - 插件：完整描述、marketplace、`N skills · M MCP · K agents`、版本/来源、冲突原因。
  - MCP：transport（stdio/http/sse）、scope（user/workspace）、连接状态、toolCount、error。
  - 若 tooltip 与 Radix 菜单 focus 冲突，退化为常驻一行描述 + 原生 `title`。
- **插件选择上限 8**（`MAX_PLUGIN_REFERENCES_PER_TURN`）：已勾选 8 个插件后，
  其余未勾选插件行 disabled 并提示上限原因；MCP 行不受限（不占 reminder 名额）。
- Footer：选择非空时显示 `已选 N` + `清除` 文本按钮。
- 关闭菜单后焦点回到编辑器（复用 Mode 菜单的 `onCloseAutoFocus` 焦点处理）。

### 空态 / 加载态

- catalog `loading` → 分组内 loading 行；`error` → 错误行 + 下次打开重试
  （`refreshRevision` 递增重新查询，沿用 hook 参数）。
- 分组无条目 → `无可用插件` / `无可用 MCP 服务器` 空态行。

## 提交序列化（渲染器侧）

### 状态 → 块

`ConversationComposer` 发送时把勾选集按当前 catalog/store 解析为：

```ts
type ComposerToolRecommendation =
  | { kind: "plugin"; pluginId: string; label: string }
  | { kind: "mcp"; serverId: string; name: string };
```

- 只保留**当前仍 enabled** 的条目；全部失效 → 不追加块。
- 插件 `label` 取 `entry.name`（canonical，不随 locale——与 mention 语义一致）。

### 块格式（第 5 类 prompt context 尾块）

追加在 `serializeComposerPromptContexts` 的最末（pptx 之后）：

```
# Recommended capabilities (the user suggests these for this turn — use only when relevant, not required):

- Plugin: [@context7](plugin://context7@zcode-plugins-official)
- Plugin: [@figma](plugin://figma@personal)
- MCP server: "filesystem"
```

设计要点：

- **插件行写成标准 `plugin://` markdown 链接**：runtime `extractPluginReferences`
  扫描全文无位置约束，链接自动触发既有 plugin reminder（live 能力清单），
  CLI/runtime **零改动**。
- MCP 行是裸文本引导（无 `mcp://` 协议；工具本就注册在 session 工具面）。
- 头部文案为英文（与 `# Code comments:` 等既有注入一致），措辞明确
  "suggests / when relevant / not required"。
- `contextAttachmentCount + 1`（有任一勾选时），保证 `/plan`、`/goal`
  等本地命令守卫继续拒绝携带 context 的提交。

### 展示解析

`parseComposerPromptContexts` 增加第 5 类解析（**最先**运行——序列化尾块，解析逆序）：

- 识别尾部 `# Recommended capabilities ...` 块 → `visibleContent` 剥离，
  返回 `toolRecommendations`。
- `ConversationUserInputContent` 把剥离后的条目渲染成一行紧凑 chip：
  插件 chip 复用既有 plugin mention 样式 + 插件 icon 投影；MCP chip 用通用样式 + 服务器名。
  保证气泡里能回看"本条消息推荐了哪些能力"。
- 旧版本 app 无此 parser → 裸块文本可见但可读（fail-open，与既有四类块相同降级）。

## 边界与事件顺序

```
用户勾选（组件态，菜单保持打开）
  → 点击发送：resolve 勾选 → 仍 enabled 的条目 → promptText 追加尾块
  → sendText/createSession firstInput（block 随 canonical text 进协议）
  → runtime turn.ts 解析 plugin:// → injectPluginReferenceReminderFromTurn
  → reminder 以 model-only system 形态追加在 user 消息后
```

- **重发/编辑再发送**：复用当前 composer 勾选态（发送后已复位=默认不选），
  与 `includeGlobalMemory` 的 resend 语义一致。
- **队列/guide 路径**：块在 promptText 内，随 replay 原样重放，天然兼容。
- **远程**：插件 catalog 经 remoteSessionId 取 session authority；MCP 列表经
  mcpSyncService directory 路由到远端目录。
- **会话期装/卸插件**：已有 session 的 catalog 冻结，picker 不显示后装插件（正确）。
- **同名插件**：以 `pluginId`（`name@marketplace`）为键，marketplace 区分，不重名冲突。
- **断连 MCP**：仍可选（连接状态只是展示徽章；advisory 语义不强依赖连接），
  但 `status==="error"` 行展示错误态。

## i18n / a11y / testid

- i18n 命名空间 `chat.toolbar.tools.*`：label、tooltip、sections.plugins、
  sections.mcpServers、selectedCount、clear、empty._、loading、error、
  conflictReason、limitReached、mcp.status._、mcp.scope.\*。
- 键盘/读屏：Radix menu 自带 roving focus + `aria-checked`；按钮 `aria-label`。
- testid：`v4-composer-tools-trigger`、`v4-composer-tools-item-plugin-{stableId}`、
  `v4-composer-tools-item-mcp-{serverId}`、`v4-composer-tools-clear`、
  `v4-composer-tools-empty`。

## 不做（明确边界）

- 不新增 `mcp://` mention scheme，不改 protocol schema、input-intent、runtime。
- 不做 session 级 MCP gating（`createSession.mcpServers` 过滤）——勾选只影响 prompt 提示。
- 不持久化选择（不进 `V4ComposerDraft`）。
- 插件内单能力（单个 skill/MCP）粒度不开放勾选——只到插件/MCP 服务器两级。
- v1 不做菜单内搜索；条目量大时再议。

## 验收场景

1. 未勾选 → 发送：`promptText` 与现状逐字一致；runtime 无 reminder。
2. 勾选 1 插件 + 1 MCP → 发送：尾块含 `plugin://` 链接与 MCP 行；
   runtime 日志/plugin reminder 注入该插件能力清单；气泡显示 chip 行而非裸块。
3. 发送成功后选择复位：按钮计数归零，下一条 `promptText` 无尾块。
4. `blocked`/`confirmationRequired`：选择保留。
5. 勾选后禁用该插件再发送：块内不含该插件。
6. 勾选插件 + `/plan` 提交：被守卫拒绝（contextAttachmentCount>0）。
7. 9 个插件全选：第 9 个起插件行 disabled。
8. 草稿态 vs 已有 session：分别看到 workspace catalog 与 session 冻结 catalog。
9. 无插件无 MCP 的 workspace：按钮不渲染。

## 验证计划

- 单测（`tsx --test`，`packages/ui/test/`）：
  - 序列化/解析 round-trip（含插件链接转义、多 MCP、空选零输出）；
  - 解析顺序（推荐块在 pptx 块之后再追加也能剥离）；
  - `contextAttachmentCount` 计数；
  - resolve 逻辑丢失效条目；
  - 插件 cap=8 的选择守卫纯函数。
- `pnpm typecheck` / `pnpm lint` / `pnpm architecture:check --changed` / `oxfmt`。
- E2E：仓库无 E2E 基建；手动验证验收场景 1–9。
