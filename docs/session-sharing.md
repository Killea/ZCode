# 局域网会话共享（Session Sharing）v1

状态：Draft  
日期：2026-10-20  
范围：Desktop + CLI/Host + UI

## 1. 背景

用户在多台开发机之间切换时，希望把一台机器上已经完成的 ZCode 会话带到另一台机器继续。
v1 不做跨设备实时同步，也不引入 relay/账号/云端；由本机 ZCode 手动启动一个只读的局域网服务，
其它 ZCode 通过地址和连接码浏览、预览、导入会话。

目标流程：

1. Linux 上 agent 完成一轮，ZCode 保持运行。
2. 用户在 Linux 的欢迎页启动「会话共享」，拿到地址和连接码。
3. 在 Mac 的 ZCode 输入连接信息，浏览 Linux 的会话或直接输入 session ID。
4. 导入到 Mac 的本地工作区后，原 session 的历史、todo、附件进入 Mac 的 session DB，可继续对话。

## 2. 目标与非目标

### 2.1 目标

- 默认关闭，必须手动启动；启动后只监听局域网。
- 只读共享：远程只能浏览、预览、导出，不能修改或删除源会话。
- 支持按 session ID 直接导入，也支持列表浏览。
- 导入后的会话可在目标机继续，模型能看到完整历史，且知道机器已经切换。
- 简单日志：谁、何时、导出了哪个会话、大小、结果。
- 不依赖 sshd、端口映射、共享文件系统、relay 或账号服务。

### 2.2 非目标（v1）

- 不做远程删除、移动或双向同步；源会话始终保留。
- 不支持跨局域网/NAT；不支持公网访问。
- 不共享远程 workspace（SSH/WSL/Docker）中的会话；只共享本机 CLI session DB 中的会话。
- 不传输工作区代码；代码仍需 git/patch 同步。
- 不做 mDNS 自动发现、二维码配对、TLS/E2E、持久化日志；这些放到后续版本。

## 3. 产品规则

### 3.1 服务生命周期

- App 启动时服务始终为 off，不恢复上次运行状态。
- 用户在欢迎页面板或设置页手动启动。
- 启动后生成地址、连接码和只读 token；停止、刷新连接码、退出 App 都会使旧 token 失效。
- 退出 ZCode 立即停止监听并断开所有连接。
- 可配置 30 分钟无活动自动停止，默认开启；手动启动/停止始终优先。
- 同一 App 进程只有一个监听实例；多窗口共享同一服务。

### 3.2 共享范围

- 共享本机 CLI session DB 中的会话，默认包含所有本地 workspace。
- 只共享 task-list session（`interactive` / `fork` / `workflow_parent`）；subagent / workflow child 不共享。
- 运行中的会话出现在列表里，但标记为 `running`，禁止导出。
- 归档会话默认不展示；可在详情里打开「包含归档」。
- fork 子会话按普通会话展示；导入时不自动带子会话。
- `session.revert` 非空、正在 compact、存在 pending/running tool 或 pending permission 的会话禁止导出。

### 3.3 连接码与授权

源端可能无人值守（用户已经去了另一台机器），因此连接码不能是几分钟过期的验证码：

- 服务运行期间连接码保持稳定，格式为 8 位 `XXXX-XXXX`。
- 面板提供「刷新连接码」；旧码立即失效，已签发 token 不受影响。
- 配对成功后签发 256-bit 只读 token，仅保存在内存，服务停止即失效。
- 同一 IP 每分钟最多 5 次配对尝试；连续失败锁定 10 分钟。
- 每次导出不再单独弹源端确认；手动启动服务 + 持有连接码视为授权。
- 源端日志记录每一次配对、导出、拒绝和断开。

### 3.4 浏览、预览与导入

- 目标端可以：浏览会话列表、查看最近消息预览、按 session ID 直接定位、导入完整会话。
- 预览只返回最近 N 条文本消息，不返回完整 tool 输出和附件；完整内容通过导入获得。
- 导入是复制：源会话不变；目标端生成新的 session ID，并记录来源 provenance。
- 目标端必须选择本地工作区；源路径只用于展示和 git 状态比对，不直接写入本地 session。

### 3.5 日志

- 内存环形缓冲 200 条；面板显示最近 1 条，「详情」弹窗显示全部。
- 服务停止或 App 退出后清空；v1 不落盘。
- 只记录元数据，不记录会话正文、tool 输出、文件内容或 token。
- 「谁」= 目标端自报的设备名 + 来源 IP；详情里标注「设备名（自报）」，不宣称强身份。
- 文案使用「导出/导入」；v1 不使用「移走/删除」。

事件：

| 事件 | 记录 |
| --- | --- |
| `service_started` | 时间、端口、绑定地址 |
| `service_stopped` | 时间、原因（手动/退出/空闲） |
| `pair_succeeded` | 设备名、IP、平台、App 版本 |
| `pair_failed` | IP、失败原因（无连接码/过期/限流） |
| `peer_disconnected` | 设备名、IP |
| `session_exported` | 设备名、IP、session ID、标题、消息数、字节数 |
| `session_export_rejected` | 设备名、IP、session ID、标题、原因（busy/not_found/revert） |
| `artifact_failed` | 设备名、IP、session ID、artifactId、原因 |
| `error` | 时间、稳定错误码、简短说明 |

## 4. 状态所有权

| 状态 | 所有者 | 说明 |
| --- | --- | --- |
| 监听器、配对码、token、连接 peer、日志 | Desktop machine-level Session Sharing service | 非 renderer；生命周期由 main 控制 |
| 面板开关、表单草稿、弹窗步骤 | Renderer | 仅 UI 状态，不持有服务事实 |
| session/message/part/entry/todo | CLI SessionStore | 源端只读；导入提交也必须走 SessionStore |
| session busy/running | CLI export 前校验（incomplete assistant turn / running tool） | 共享服务不持有 runtime 状态 |
| tasks-index/sessions-index | Desktop Host | 导入后由打开会话的既有导航触发 Host 恢复；不直接改 DB |
| artifact 文件 | CLI artifact store | 源端按 URI 读取；目标端复制到新 session 目录 |

共享服务不得持有 task/session 业务状态，不得解析 conversation stream；只做传输和只读导出。
Desktop main 不直接打开 session DB：源端 list/export 与目标端 import 都通过短生命周期
`zcode __session-share ...` 子进程完成，session 事务的唯一写入口仍是 CLI SessionStore。
Renderer 不得直接监听端口或读写 session DB。

## 5. 网络与安全

### 5.1 仅局域网

- 枚举本机 IPv4，仅允许 RFC1918（10/8、172.16/12、192.168/16）和回环地址。
- 默认绑定主私有网卡；多网卡时在详情弹窗中选择。
- 不绑定公网地址，不监听 `0.0.0.0` 的公网可达接口。
- HTTP 层再次校验 `request.socket.remoteAddress` 必须是私有/回环地址。
- 不信任 `X-Forwarded-For`、`Forwarded` 等代理头。
- 不使用 UPnP、端口映射、公网公告。
- 未检测到私有 IPv4 时禁止启动，并给出明确原因。

### 5.2 认证

- `POST /v1/pair` 之外的 session/artifact 接口必须带 `Authorization: Bearer <token>`。
- token 只存内存；按服务实例隔离；停止/刷新后旧 token 失效。
- 支持查看已连接设备并逐个断开。
- 错误响应不泄露 session 是否存在之外的敏感信息。

### 5.3 请求边界

- 只实现 `GET` 和 `POST /v1/pair`；没有写/删接口。
- 关闭 CORS；不返回 `Access-Control-Allow-Origin`。
- 所有响应 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff`。
- 路径参数必须过 schema 和白名单；artifact 只能读取当前 session 的 artifact store，禁止任意文件路径。
- 限制请求体大小、并发导出数、单 session 导出大小、单 artifact 大小和请求超时。
- 日志只记录元数据，token、连接码哈希、会话正文不落日志。

### 5.4 传输安全

- v1 使用 HTTP + token，明确提示「仅限可信局域网」。
- 已知风险：开放 Wi-Fi 上 token/内容可被嗅探；用户须自行判断网络可信度。
- 后续版本再引入 TLS（配对链接携带证书指纹）或端到端加密。

## 6. 接口契约

公共约定：

- `schemaVersion: 1`。
- JSON 使用 UTF-8；导出流使用 `application/x-ndjson`。
- 所有时间戳为 Unix ms。
- 所有请求/响应在两端用 zod 严格校验。

### 6.1 `POST /v1/pair`

请求：

```json
{
  "code": "A7K2-9QMX",
  "client": {
    "name": "MacBook-Pro",
    "platform": "darwin",
    "appVersion": "3.15.1"
  }
}
```

响应：

```json
{
  "schemaVersion": 1,
  "token": "<opaque>",
  "expiresAt": 1760000000000
}
```

错误：`pair_code_invalid`、`pair_rate_limited`、`pair_locked`。

### 6.2 `GET /v1/sessions`

Query：`q`（标题/ID 搜索）、`workspace`（源路径过滤）、`includeArchived`、`limit`（默认 50，最大 100）、`cursor`。

响应：

```json
{
  "schemaVersion": 1,
  "sessions": [
    {
      "id": "sess_...",
      "title": "重构登录流程",
      "workspacePath": "/home/hank/Flux2Image",
      "createdAt": 1760000000000,
      "updatedAt": 1760000000000,
      "messageCount": 42,
      "partCount": 318,
      "status": "idle",
      "sizeBytes": 12991234,
      "artifactCount": 3,
      "taskType": "interactive",
      "parentID": null
    }
  ],
  "nextCursor": null
}
```

### 6.3 `GET /v1/sessions/:id`

返回导入前 manifest：

```json
{
  "schemaVersion": 1,
  "session": { "id": "sess_...", "title": "...", "directory": "/home/hank/Flux2Image" },
  "workspace": {
    "path": "/home/hank/Flux2Image",
    "gitHead": "abc123",
    "gitDirty": true,
    "platform": "linux"
  },
  "source": {
    "deviceId": "device-linux",
    "deviceName": "linux-dev",
    "appVersion": "3.15.1",
    "exportedAt": 1760000000000
  },
  "counts": { "messages": 42, "parts": 318, "entries": 12, "todos": 4 },
  "artifacts": [
    { "artifactId": "tool-result-...", "mime": "image/png", "sizeBytes": 12345, "sha256": "..." }
  ]
}
```

### 6.4 `GET /v1/sessions/:id/preview?limit=20`

只返回最近消息的纯文本预览：

```json
{
  "schemaVersion": 1,
  "messages": [
    { "role": "user", "text": "..." },
    { "role": "assistant", "text": "..." }
  ],
  "truncated": true
}
```

不返回 reasoning、完整 tool 输出、附件字节。

### 6.5 `GET /v1/sessions/:id/export`

返回 JSON bundle（v1 实现使用 JSON；artifacts 字节不内联）：

```json
{
  "schemaVersion": 1,
  "exportedAt": 1760000000000,
  "source": {
    "deviceId": "device-linux",
    "deviceName": "linux-dev",
    "appVersion": "3.15.1",
    "exportedAt": 1760000000000,
    "workspacePath": "/home/hank/Flux2Image",
    "gitHead": null,
    "gitDirty": null,
    "platform": "linux"
  },
  "snapshot": {
    "session": { "id": "sess_...", "title": "...", "directory": "/home/hank/Flux2Image" },
    "messages": [],
    "entries": [],
    "todos": [],
    "artifactUris": [],
    "droppedEntryCount": 0
  },
  "artifacts": [
    {
      "artifactId": "tool-result-...",
      "mime": "image/png",
      "sizeBytes": 12345,
      "sha256": "...",
      "file": "artifacts/tool-result-....bin"
    }
  ]
}
```

- `session/message/part/entry/todo` 使用 CLI 持久化的业务结构。
- 导出前必须确认会话 idle；否则返回 `409 session_busy`。
- 导出期间会话不得写入；以开始导出时的 read snapshot 为准。
- 目标端下载 bundle + 每个 artifact，写入临时目录后调用内部
  `__session-share import` 命令；导入端再次校验 sha256 并走 SessionStore 事务。

### 6.6 `GET /v1/sessions/:id/artifacts/:artifactId`

返回字节流，带 `Content-Type`、`Content-Length`、`X-ZCode-Sha256`；可选支持 `Range`。

### 6.7 错误码

| HTTP | code | 说明 |
| --- | --- | --- |
| 400 | `invalid_request` | schema 校验失败 |
| 401 | `unauthorized` | 缺少/无效 token |
| 403 | `lan_only` | 来源不是私有/回环地址 |
| 404 | `session_not_found` | session/artifact 不存在 |
| 409 | `session_busy` | 运行中、compact、revert 或 pending interaction |
| 409 | `session_conflict` | 目标端已有同 ID（复制模式应改用新 ID） |
| 413 | `payload_too_large` | 超过导出/artifact 限制 |
| 429 | `pair_rate_limited` | 配对尝试过多 |
| 500 | `internal` | 未分类错误 |

## 7. 导入契约

### 7.1 复制模式

v1 只有 copy：

- 目标端用 `sha256(sourceDeviceId + "\0" + sourceSessionId)` 生成确定性 session ID
  `sess_import_<hash>`；同一目标机重复导入同一源会话时返回已有会话，`reused: true`，
  不重复写消息或 artifact。
- 同一源会话在目标机只保留一份副本；需要第二条分支时对导入后的会话执行 fork。
- provenance 记录源 device ID、device 名、源 session ID、源路径、git HEAD、导出时间。
- 源会话保持不变，不提供远程删除/移动接口。
- UI 和日志使用「导出/导入」，避免让用户误以为源会话已消失。
- 导入后的 session 是根任务：`taskType = interactive`，`parentID` / `traceID` / `shareURL`
  清空；fork 关系由 provenance 记录。

### 7.2 目标端预检

v1 已实现：

- `schemaVersion` 是否支持。
- 本地工作区非空。
- 源会话 idle（CLI export 的 todo/tool/incomplete-turn 检查）。
- artifact 集合完整性与 sha256。

仍由目标端 resume/用户确认处理：

- 模型/provider 是否在目标机可用；不可用则由目标端选择替代模型。
- 磁盘空间不足由下载/导入写入失败返回。
- UI 展示源 workspace/git 信息，并提示「会话是快照，不包含工作区代码」。

### 7.3 写入规则

- 在一个事务中写入 session/message/part/entry/todo；任何失败整体回滚。
- 重新计算 `projectID`、`directory`、`path`；保留 title 和 created time；导入为
  `interactive` 根任务，`parentID` 清空。
- message/part 保留原 ID（内部 `parentID`、compact boundary、anchor 引用继续有效），
  只把 `sessionID` 改成目标 ID；导入事务在写入前显式拒绝跨 session 的 message/part/entry
  ID 复用，不能依赖 upsert 改绑旧记录。
- portable entry 只导入 `runtime/model_selection` 和
  `runtime/dynamic_workflow_activation`；shell 选择、workspace checkpoint、workspace file
  rewind、execution state、pending interaction 等机器本地 entry 全部丢弃。
- 每条 portable entry 的 ID 重新命名空间为 `<type>:<newSessionId>:<hash>`。
- 附件：下载到 staging → 校验 sha256 → 通过 target artifact store 重新写入 →
  重写 FilePart 的 `zcode-artifact://` URI、`metadata.artifactUri`、tool state attachments。
  目标 artifact ID 由 store 重新生成，不能假设与源 ID 相同。
- `local_ref` 附件无法复制，保留文字标签并在导入结果中提示。
- 写入 `runtime/remote_session_import` session entry，包含 provenance 和 `mode: "copy"`。
- 导入结果返回稳定 warning code：`machine_local_entries_dropped`、
  `local_reference_attachments_skipped`、`source_workspace_dirty`。
- 首次上下文注入一条机器切换提示：历史中的路径/tool 输出属于源机器，继续前必须重新核实工作区。
- 导入完成后刷新 sessions-index/tasks-index，并打开新会话。

### 7.4 环境刷新

- 导入的 session 不能沿用源机 `envInfo`（platform/shell/osVersion/git status）。
- 导入时直接清除 user message 的 `contextSnapshot`，使首次 resume 重新探测环境；
  不依赖 `extractPersistedEnvInfo` 的旧快照。
- shell 选择、权限模式等机器本地状态按第 7.3 节处理。

### 7.5 失败与取消

- 失败时删除 staging，不留下半写入 session。
- 取消时中止 HTTP 请求、清理 staging；源端不受影响。
- 目标端写入失败不得触发源端任何删除动作（v1 本来也没有删除）。

## 8. UI

### 8.1 欢迎页面板

位置：欢迎页四个建议 prompts 下方，与 composer 同宽，独立卡片；默认收起为一行。

关闭：

```text
┌───────────────────────────────────────────────────────────────┐
│ ○ 会话共享已关闭    仅限局域网 · 手动启动            [启动共享] │
└───────────────────────────────────────────────────────────────┘
```

运行中：

```text
┌───────────────────────────────────────────────────────────────┐
│ ● 会话共享中    http://192.168.1.23:51234/#code=A7K2-9QMX     │
│   [复制连接信息] [刷新连接码] [停止]       已连接 1 台设备      │
│   最近：14:32 MacBook-Pro 导出了《重构登录流程》      [详情]   │
└───────────────────────────────────────────────────────────────┘
```

连接码放在 URL fragment（`#code=...`），不会随 HTTP 请求发送给服务端，也不会进入访问日志。
源端「复制连接信息」复制完整 URL；目标端只需粘贴一次。

- 启动中显示 spinner；失败显示错误 + 重试。
- 多网卡时详情弹窗提供绑定地址选择。
- 运行中在 Header Help 左侧显示绿色状态点；点击打开同一详情弹窗。
- 仅本地 Desktop 欢迎页展示；手机 Web、远程 workspace、窄屏隐藏。

### 8.2 详情/日志弹窗

- 服务状态、绑定地址、端口、连接码、刷新/停止。
- 已连接设备列表：设备名（自报）、IP、平台、连接时间、断开按钮。
- 日志过滤器：全部/连接/导出/错误；支持复制日志、清空。
- 底部提示：「仅限同一局域网；退出 ZCode 将自动停止共享」。

### 8.3 目标端导入弹窗

步骤：

1. 粘贴源端复制的连接信息 URL（`http://address:port/#code=CODE`）；也支持直接输入完整 URL。
2. 浏览列表或输入 session ID；支持按标题/ID 搜索。
3. 会话预览：标题、工作区、消息数、大小、状态、最近消息。
4. 选择本地工作区；展示源 git HEAD/dirty 与代码同步提示。
5. 导入进度：消息/part、artifact 数量与字节数；可取消。
6. 成功：打开会话，并在时间线顶部显示 provenance 横幅；如果 `reused: true`，提示「该会话已导入过」并直接打开已有会话。

源会话 `running` 时禁用「导入」，提示「完成后可导入」。

### 8.4 日志文案

- 成功：`14:32 MacBook-Pro (192.168.1.8) 导出了《重构登录流程》 12.4 MB`
- 拒绝：`14:35 MacBook-Pro 请求导出《修复登录问题》，会话仍在运行，已拒绝`
- 配对失败：`14:30 192.168.1.9 配对失败（连接码错误）`
- 空态：`暂无活动`

## 9. 验收场景

1. **默认关闭**：启动 App 后无监听端口；面板显示关闭；不自动恢复上次运行。
2. **仅局域网**：服务只绑定私有 IPv4；来自公网地址的请求返回 403；不信任代理头。
3. **配对**：错误连接码/过期/超限返回稳定错误；正确连接码签发 token；刷新后旧码失效。
4. **浏览与预览**：目标端能看到会话列表和最近消息；running 会话标记正确；归档默认隐藏。
5. **导入**：导入带文本、todo、图片 artifact 的会话；新 session 可继续对话；历史完整；附件可读。
6. **环境刷新**：在 Linux 导入的会话在 Mac 上首次 resume 时，system context 显示 darwin/zsh，而不是旧的 Linux 快照。
7. **路径重绑**：源路径 `/home/...` 与目标 `/Users/...` 不同，导入后 cwd 为本地工作区；不会在源路径执行工具。
8. **busy 拒绝**：运行中/compact/pending permission 的会话不能被导出。
9. **日志**：导出后源端出现设备名、IP、会话标题、大小；日志不含正文/token。
10. **停止**：停止共享或退出 App 后端口关闭、token 失效、已连接 peer 断开。
11. **失败恢复**：目标端导入中断/磁盘不足/校验失败时不留下半会话；源端会话不受影响。
12. **多窗口**：多个窗口只存在一个监听实例；Header 状态一致。
13. **跨平台**：Windows/macOS/Linux 的私有地址枚举、路径处理和防火墙提示正确。

## 10. 实现分期

当前状态（2026-10-20）：

1. **协议与契约**：已完成 shared schema、错误码、Desktop IPC 频道与 `IPlatformService` 方法。
2. **CLI 导出/导入**：已完成 `__session-share list/export/import`、SessionStore 导入事务、artifact 复制/URI 重写、路径重绑、portable entry、provenance、环境刷新。
3. **Desktop 服务**：已完成机器级 HTTP 服务、私有 IPv4 绑定、来源校验、稳定连接码、token/限流、列表/预览/manifest/export/artifact、内存日志、start/stop/status/logs IPC。
4. **UI**：已完成欢迎页面板、详情/日志弹窗、局域网导入弹窗、Header 运行状态和中英文 i18n；导入完成后复用既有 task 导航打开会话。
5. **收口**：已覆盖共享契约、导入事务、transfer round-trip、service pairing/export/import 测试；跨平台 UI 实机与 mDNS/TLS/E2E/move 仍为后续版本。

后续：

- 同一局域网 mDNS/二维码发现、TLS/E2E。
- 显式 move/交接（冻结源端 + 两阶段清理）。
- 导入后强制刷新 sessions-index 的显式事件（当前依赖打开会话触发 Host 恢复）。
- 跨平台实机 E2E 与大数据 artifact 分块/续传。

## 11. 待确认决策

| 决策 | 当前选择 | 备注 |
| --- | --- | --- |
| copy vs move | v1 copy | move 需要冻结源端 + 两阶段删除，后续版本 |
| 重复导入 | 幂等 | 目标端用 sourceDeviceId + sourceSessionId 生成确定性 ID；返回已有会话 |
| 连接码有效期 | 服务运行期间稳定 | 源端无人值守；可手动刷新 |
| 传输安全 | HTTP + token | 仅可信局域网；TLS/E2E 后续 |
| 共享范围 | 所有本地 workspace | 后续可加 workspace 白名单 |
| 空闲自动停止 | 30 分钟，默认开启 | 可配置 |
| 日志持久化 | 不落盘 | 内存 200 条 |
| 设备身份 | 稳定 deviceId + 自报名称/IP | deviceId 只用于幂等和 provenance；不宣称强身份 |
| 每次导出确认 | 不确认 | 手动启动 + 连接码视为授权 |

## 12. 参考代码

- Session 持久化与恢复：[`apps/zcode-cli/docs/design/v2/session-persistence.md`](../apps/zcode-cli/docs/design/v2/session-persistence.md)
- SessionStore 契约：[`session-store.port.ts`](../apps/zcode-cli/packages/contracts/src/interfaces/session-store.port.ts)
- Artifact store：[`storage/index.ts`](../apps/zcode-cli/packages/adapters/src/storage/index.ts)
- Resume 环境恢复：[`resume.ts`](../apps/zcode-cli/packages/core/src/runtime/methods/resume.ts)
- 欢迎页/建议 prompts：[`SessionPane.tsx`](../packages/ui/src/v4/SessionPane.tsx)、[`ConversationDraftSuggestedPrompts.tsx`](../packages/ui/src/v4/ConversationDraftSuggestedPrompts.tsx)
- Header 操作区：[`WorkspaceHeaderActionSection.tsx`](../packages/ui/src/WorkspaceHeaderSections/WorkspaceHeaderActionSection.tsx)
- 设计规范：[`DESIGN.md`](../DESIGN.md)
