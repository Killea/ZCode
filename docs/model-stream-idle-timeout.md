# 模型级流式空闲超时（streamIdleTimeoutMs）

## 背景

`modelStream.idleTimeoutMs`（`DEFAULT_MODEL_STREAM_IDLE_TIMEOUT_MS`）约束 SSE 流上**每一次
读事件**的最长等待——包括首个事件，因此它也是「请求在 provider 侧排队/慢推理时客户端愿意
等多久」的上限。本地推理模型（如 openai-compatible 的 127.0.0.1:8080）在并发子代理请求下
排队时间可能远超原 10 分钟默认，客户端先放弃会把可恢复的等待变成失败。

## 规则

1. 新模型属性 `properties.streamIdleTimeoutMs`（正整数，毫秒，可选）是模型级叶子：
   - schema：`completeModelPropertiesDataSchema` 增加**可选**字段；内置模型不设该字段时
     语义不变。
   - 手动模型配置：`manualModelConfigSchema` pick 该叶子，使其可出现在个人 overlay
     （personalConfig）中，参与继承/覆盖/恢复的既有 sparse 机制。
2. 运行时优先级：`model.properties.streamIdleTimeoutMs` > 进程级
   `modelStream.idleTimeoutMs` > `DEFAULT_MODEL_STREAM_IDLE_TIMEOUT_MS`。覆盖点在
   `runner-stream` 每次尝试计算 `resolveModelStreamIdleTimeoutMs` 的 `baseTimeoutMs`；
   retry 递增（+30s/次）规则不变。
3. 默认值：`DEFAULT_MODEL_STREAM_IDLE_TIMEOUT_MS` 由 600_000 调整为 1_800_000（30 分钟），
   对所有未显式配置的模型生效。
4. UI：模型编辑对话框新增「Stream idle timeout」数字输入，**单位为秒**（存储毫秒 ×1000）：
   - 空输入 = 不写个人覆盖（智能模式下继承；固定模式下回退进程级默认）；
   - 非正整数在 commit 时按 `streamIdleTimeout` 字段报 invalid；
   - 显式填写即覆盖（与 contextWindow 同一规则：即使与继承相等也保留），清空即撤销。

## 所有者

- 值的唯一事实来源仍是 resolved `Model.properties`（provider config 合并 builtin 默认 +
  personal overlay）。runner 不维护第二份超时表；UI 不写第二份 effective config。

## 验收场景

- 手动模型 `properties.streamIdleTimeoutMs = 1_800_000` → SSE 每次读等待上限 30min(+retry 递增)。
- 未设置该属性的模型 → 进程级默认 30min；用户在全局 config 显式设置 `modelStream.idleTimeoutMs`
  时模型未设属性才用全局值。
- 对话框清空超时字段保存 → personalConfig 中无该叶子；填非数字 → invalid.streamIdleTimeout。
