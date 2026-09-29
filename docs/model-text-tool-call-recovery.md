# 文本态 tool_call 标记的兜底执行（text markup tool call recovery）

## 背景

自托管 openai-compatible 端点（本地推理服务）上，模型可能以**纯文本**形态输出
Hermes/Qwen 风格的工具调用标记：

```text
<tool_call>
<function=WebFetch>
<parameter=url>
https://example.com
</parameter>
</function>
</tool_call>
```

服务端只从结构化 `tool_calls` 通道解析工具调用；当模型输出的标记未被服务端提取时，
该文本随 `finishReason: stop` 作为普通 assistant 文本返回。旧逻辑将其视为 turn 的自然
结束：模型以为已经发起工具调用，实际无人应答——表现为"推理停住"，turn 永远结束。

## 规则

1. 触发条件：模型 step 完成且 `executableToolCalls` 为空时，扫描
   `state.modelResponse` 中的完整 `<tool_call>…</tool_call>` 块（必须有闭合标签；
   截断残块视为普通文本，output-limit 续写路径在本规则之前生效）。
2. 支持的两种块内形态：
   - `<function=NAME>` + 零或多个 `<parameter=KEY>VALUE</parameter>`（KEY 的闭合
     兼容模型错写 `</name>`、遗漏闭合直接接下一个 `<parameter=` 或 `</function>`）。
   - 块内直接是 JSON：`{"name": "X", "arguments": {...}}`（Hermes 变体；
     `arguments`/`parameters`/`input`/`args` 字段均可，字符串值尝试 JSON 解析）。
3. 每个解析出的调用合成为 `ModelToolCall`（id 由 `createToolCallId` 生成），
   走与真实 tool call 完全相同的执行管线（`commitAssistantToTurnRequest` +
   `executeToolCallsForModelStep`）：
   - 名字已注册 → 正常权限/校验/执行（输入校验失败按既有工具错误结果回灌）；
   - 名字未注册 → 既有 registry-miss 产出 `Tool not found: X` 的
     `<tool_use_error>` 结果回灌，模型据此自我修正继续推理。
4. 上限：单次响应最多恢复 `MAX_TEXT_MARKUP_TOOL_CALLS = 8` 个调用；计数照常进入
   `state.toolCallCount`，重复签名/异常 streak 等既有护栏继续生效。
5. 当响应同时带有真实结构化 tool_calls 时，文本标记不重复恢复（真实调用优先，
   标记文本保留为 assistant 内容）。
6. assistant 文本**不删除**标记原文：它如实记录模型的失败尝试，配合工具错误
   结果让模型知道"该调用没有被执行"。

## 所有者

- 解析与合成在 core turn step 边界（`turn-model-step.ts` 空 toolCalls 收口处），
  helper 在 `runtime/helpers/text-tool-call-recovery.ts`，不感知具体 provider。
- 未注册名的错误形态复用 executor 的 `CoreErrorType.ToolNotFound` 路径，
  不新建第二套"工具不存在"表达。

## 验收场景

- 模型输出 `<tool_call><function=WebFetch>…</tool_call>` + finishReason=stop
  → turn 不结束；该调用走 registry-miss 产出 `Tool not found: WebFetch` 错误结果
  回灌，下一轮请求继续。
- 标记调用已注册工具（如 `Read`）→ 走正常 executor（含权限与输入校验）。
- 文本含残缺 `<tool_call>`（无 `</tool_call>`）→ 不恢复，turn 正常结束。
- 文本无标记 → 行为不变。
- 同一响应含结构化 tool_calls + 标记文本 → 只执行结构化调用。
