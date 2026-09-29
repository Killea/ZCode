# 工具取消时透出父级 abort 原因

## 背景与问题

工具调用被取消时，`executeWithTimeout` 只产出 `ToolEntry.cancellation.userVisibleMessage`
（如 `MCP tool X was cancelled`），**丢弃 `abortSignal.reason`**。而父级取消方其实一直带着
可读原因，例如：

- `stopActiveForegroundExecution({ reason: "Protocol runtime stopping" })`——host 断开 /
  应用重启 / 协议运行时关闭时在飞工具被收口；
- `stopActiveForegroundExecution` 默认原因 `"foreground execution stopped"`——用户停止或
  队列抢占。

后果：用户分不清"自己停了"还是"agent 运行时死了"，模型侧也只看到泛化取消文案。
实际事故：yolo 模式下 `mcp__playwright__browser_run_code_unsafe` 报
`was cancelled`，真实原因是 host 侧协议运行时关闭（SdkError: Protocol runtime stopping），
与权限完全无关。

## 产品规则

- 工具因 `abortSignal` 取消（含进入时已 aborted）时，若 reason 携带可读文本
  （`Error.message` 或 string），附加到用户可见消息后：`… was cancelled — <reason>`。
- reason 为通用 `AbortError` DOMException（即不带语义的无原因 abort）或空值时不附加，
  保持原文案。
- 只改消息文本，不改错误类型（仍为 `ToolCancelled`）、recoverable、cleanup 语义与
  上游 turn 收口逻辑。
- 超时路径（`ToolTimeout`）不受影响。

## 接口

`timeout.ts` 内部新增 `abortReasonDetail(signal)`（纯函数）。无新外部契约。

## 验收场景

- `abort(new Error("Protocol runtime stopping"))` → 消息含 `Protocol runtime stopping`。
- 裸 `abort()`（AbortError DOMException）→ 消息与原来一致。
- 进入执行前 signal 已 aborted → 同样附加 reason。
- 正常超时 → `ToolTimeout` 行为不变。
