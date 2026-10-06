# App 退出确认(活跃会话保护)

桌面端在有活跃会话时关闭最后一个主窗口或触发应用退出,必须先弹原生确认框;
用户取消则窗口保持打开,确认才继续正常退出清理。

## 产品规则

- 触发点:非 macOS 平台最后一个主窗口的关闭按钮、macOS Cmd+Q/菜单退出(`before-quit` 兜底)。
- 存在至少 1 个活跃会话 → `dialog.showMessageBoxSync` 确认框(退出/取消),文案列出活跃会话数。
- 无活跃会话 → 直接退出,不弹框。
- `forceQuit`(更新安装、调试强制退出、已确认过的退出重入)与 Windows close-to-tray、非最后窗口关闭均不弹框。
- 拦截门控以安装形态为准:所有打包产物(含连 test 后端的 Preview/本地 linux-unpacked)
  都启用确认;未打包的 `pnpm dev:desktop` 与 E2E(`ZCODE_E2E_RUN_ID`)运行不拦截,
  避免打断调试与自动化退出清理。
- macOS 窗口关闭按钮走 `handleDarwinWindowCloseRequest`(隐藏而非退出),不在本规则内。

## 活跃会话定义

"会话正在运行"的唯一事实来源是 sessions-index 的 `SessionSummary`(v4 摄入,
`zcodeTaskIndexSyncer` 持有的 `state.summaries` 基线),不再使用 sendPrompt RPC 生命周期推断。

单条 summary 视为活跃,当且仅当:

- `phase ∈ {prewarming, running}`(轮次在途),或
- `hasBackgroundWork === true`(父轮已收口但 subagent/后台工作仍在跑——
  这是「父会话完成、子代理继续执行」期间也必须拦截退出的关键)。

计数口径:

- `phase = "draft"` 的会话永远不计。
- `parentSessionId` 指向仍存在于同一 workspace 基线的会话时,该子会话不单独计数
  (父会话经 `hasBackgroundWork` 已覆盖;避免父+子重复计数夸大对话框数字)。
- `parentSessionId` 缺席或父会话已不在基线中的子会话按顶层会话单独计数(孤儿兜底)。
- `runtimeGeneration === null` 的 workspace 贡献 0:runtime 已死/未 attach 时,
  基线里残留的 running 摘要只是陈旧数据,不能据此永久拦截退出。

## 状态所有者与事件顺序

```
CLI runtime ──sessions-index topic──> zcodeTaskIndexSyncer (services)
   state.summaries 基线 + 活跃计数投影
   onRunningSessionCountChanged(count)          ← 唯一计数事实源
        │
        ▼ taskRuntimeReporter.onRunningTaskCountChanged   (services → host 注入通道)
   desktop host (src/host/index.ts)
   AgentRunningTaskCountChanged {
     runningTaskCount = localRuntimeSessionCount      // syncer 投影
                      + workspaceTaskTracker 远程代理计数 // remote sendPrompt 路径
                      + untrackedPromptRpcCount           // 无 meta 的 sendPrompt ACK 期
   }                                                   ← host 是唯一写方,三路求和
        │
        ▼ parentPort
   main (desktopHostProcess) → hostRunningTaskCountMap
   getRunningAgentSessionCount() = Σ map values
   shouldConfirmAppQuit() = app.isPackaged && !e2eRun && count > 0
```

- 本地 runtime 的会话(含 subagent session、自动化/off-peak 任务 session)经 syncer 计数;
  远端 workspace 的会话跑在远端 server,本地 syncer 不可见,继续由
  `workspaceTaskTracker`(remote `sendPrompt`/`onDynamicTaskReady` 包装)计数——两路不相交。
- host 对 `AgentRunningTaskCountChanged` 是唯一写方;main 只做 per-host 求和,
  不自己判断"什么叫活跃"。

## 确认框行为

- `confirmAppQuit` 弹同步原生框;`defaultId`/`cancelId` 指向"取消",防误触退出。
- 窗口 close 分支:`handleDesktopWindowCloseRequest` 在 `isLastWindow && !forceQuit` 时
  调用 `confirmQuit()`;取消 → `event.preventDefault()`,窗口保持打开。
- `before-quit` 分支(Cmd+Q/托盘退出):取消 → `preventDefault()` 并复位
  `explicitQuitRef`,避免下一次窗口关闭绕过托盘设置。
- 确认后走正常 `prepareAppQuit` 清理(host 进程、media registry 等),不新增旁路。

## 验收场景

1. 主会话 sendText 轮次在途(phase=running)→ 点窗口 X → 弹确认框;取消 → 窗口保留。
2. 父轮完成但 subagent 仍在跑(hasBackgroundWork)→ 点 X → 弹确认框。
3. 确认退出 → `prepareAppQuit` 正常清理并退出。
4. 所有会话空闲(terminal/draft)→ 点 X → 直接退出不弹框。
5. `forceQuit`(quitAndInstall 等)→ 不弹框。
6. 冷启动时仍有 running 会话(hydration 基线)→ 弹确认框。
7. runtime 死亡未恢复 → 不计数,不阻塞退出。
