# Host stdio 写入韧性

桌面 Local Host(`zcode-host`,Electron Utility Process）的日志双通道：

- `parentPort.postMessage(HostResponseTypes.Log)` —— 结构化日志，RPC 通道，宿主与 main
  的主链路。
- `console.log/warn/error` → `process.stdout/stderr` —— main 侧 `hostLogRelay` 捕获的
  原始日志旁路（`[host-log]` 前缀）。rawConsole 与 console 覆盖层都写它。

## 规则

0. **host 以 `stdio: "pipe"` 拉起，stdout/stderr 是 main 独占的私有管道。**
   `spawnHostProcess` 的 `utilityProcess.fork` 必须显式配置 `stdio: "pipe"`
   （= `['ignore','pipe','pipe']`，stdin 不支持非 ignore)。默认 `inherit` 会把
   host 的 stdout 接到**整个 App 共享的 stdout fd** 上——读端随启动方环境关闭
   （终端退出、管道断裂）即触发 EPIPE，且 `child.stdout` 恒为 null 使
   `hostLogRelay` 的 raw 兜底通道失效。配 pipe 后：写端只受 main 生命周期影响
   （teardown 时才关），早期崩溃栈、native warning、stderr 噪声也能被 relay 捕获。
   管道读端只由 main 在 host 退出流程中关闭。cron scheduler
   （`spawnCronScheduler`）按同一规则配 `stdio: "pipe"`，其 stdout/stderr 由
   main 侧 drain 消费（结构化日志仍走 `scheduler-log` postMessage),pipe 无消费者
   时子进程输出超过缓冲区会被写阻塞，所以配 pipe 必须同时挂 data 监听。

1. **stdio 写失败不得杀死宿主进程。** 管道读端（main 侧）关闭后，同步 `write` 抛
   `EPIPE`；异步失败以 stream `'error'` 事件抛出。任一路径未兜住都会升级为
   `uncaughtException` → `disposeHostResources` → `process.exit(1)`,host 持有的全部
   session/subagent 在途任务随之冻结（UI 永远停在 running/waiting)。
   - `process.stdout` / `process.stderr` 挂 `error` 监听吞掉异步错误并置
     `hostStdioBroken`。
   - 所有 `rawConsole.*` 调用点（`writeHostLog`、console.log/warn/error 覆盖层）经
     `safeRawConsoleWrite` 包裹；写入抛错同样置 `hostStdioBroken`，此后跳过 stdio
     写入（每次写都已知必败，省开销）。
   - `reportHostLog`(parentPort 通道）不受影响，日志仍可到达 main。
2. **EPIPE 在 uncaughtException 防线中归类为可恢复。** `hostUncaughtExceptionGuard`
   在原有"native TLS 分配失败"之外，把 `error.code === "EPIPE"`（写已关闭管道/子进程
   stdin，本质是丢失一次写，不携带进程级损坏状态）交给 `onRecovered` 记录 warn 而非
   `onFatal` 杀进程。

## 所有者与事件顺序

- stdio 降级标志的唯一 owner:`packages/desktop/src/host/index.ts` 模块级
  `hostStdioBroken`，只增不减（管道断了不会自愈）。
- 事件顺序：stdio 断 → `error` 事件/同步抛错 → 置 flag → 后续写跳过 → 日志只走
  parentPort；进程继续服务。
- 兜底：任何逃逸的 EPIPE → `uncaughtException` handler → `onRecovered` warn →
  进程存活。

## 验收场景

- stdout 读端关闭后调用 `writeHostLog`/`console.*`：无抛出，host 继续运行，
  `reportHostLog` 仍上送日志。
- 非 stdout 的流写 EPIPE 逃逸成 uncaughtException：记录 warn，不退出。
- 其他 uncaughtException（非 EPIPE、非分配失败）：维持 fatal 语义，dispose 后退出。
