# 模型输入模态拒绝后的降级重试（input modality repair）

## 背景

模型能力（`properties.inputFormat.supportsImage/supportsPdf/supportsVideo`）是**声明式**的：
personal provider（openai-compatible 自托管端点，如本地推理服务）的模态开关由用户在模型
元数据里手工勾选。声明与服务端真实能力可能不一致——声明 `supportsPdf: true` 但服务端实际
不支持 `file` 内容块时，请求带着 `{"type":"file","file":{…}}` 到达上游，被 400 拒绝
（`provider_code=modality_not_supported`，message 形如 `content type 'file' is not
supported`）。该错误归一化为 `invalid_request / retryable=false`，turn 直接失败，用户
卡在死掉的请求上。

## 规则

1. provider 业务错误携带 `provider_code=modality_not_supported`，或错误消息匹配
   `content type '<kind>' is not supported` 时，视该模态为**本次请求级别**被拒：
   - 能从消息解析出 wire 类型时按类型归并：`image`/`image_url` → image；
     `file` → file（`file` part 同时承载我们的 PDF file 块与 video 块，两者一并降级）；
     `video`/`video_url` → video；解析不出类型 → 全部 provider-visible 媒体。
   - 解析出 `text` 等无法降级的类型时不修复，按原错误抛出。
2. 修复动作只对**本次模型调用的请求副本**生效：把被拒种类的 provider-visible 媒体块
   （`projectMessagesForInputFormat` 同一组判定谓词）替换为
   `createUnsupportedModelInputMediaText` 的文本占位，与声明关断时投影出的形态完全一致。
   不写回 canonical history，不修改用户声明的能力配置。
3. 修复重试不占普通 retry 预算：与 reasoning signature repair 同模式，每次修复给一次
   带新 requestId 的物理请求，`maxAttempts`/`retryBudgetAttempt` 记账方式相同。
   同一 kind 只修复一次；不同 kind 可以继续修复（file 修完再被 image 拒，仍可以再修一次）。
   修复总次数封顶 `MAX_INPUT_MODALITY_REPAIR_ATTEMPTS = 3`。
4. 已发出可见输出（`emittedRetryBoundaryEvent`）后不再修复——与既有重放纪律一致。
5. 流式与非流式路径同样生效（`runner-stream.ts` / `runner-generate.ts` 对称接入）。
6. 重试状态事件的 `retryReason` 为 `input_modality_repair`：它是本地降级而非 provider
   失败，与 `reasoning_signature_repair`/`auth_refresh` 同类——UI 归
   `fault.provider.requestFailed`，workflow 并发治理不计为失败重试。

## 所有者

- 请求副本的改写发生在 adapter 的 retry 边界（runner-stream / runner-generate），
  模态谓词与占位文案复用 `@zcode/contracts` 的 media-policy，不复制第二份判定。
- 修复状态是单次模型调用内的局部量；不做跨请求的能力学习（provider 每次拒绝才降级），
  sense 与 `repairThinkingSignatureRejection` 相同。

## 验收场景

- 声明 `supportsPdf: true` 的 openai-compatible 模型收到 `content type 'file' is not
  supported`（HTTP 400 或 SSE error chunk）→ 请求副本中 PDF/视频 file 块全部替换为
  `[Media omitted…]` 文本后重发一次，turn 继续。
- 随后上游再拒 `image` → 仍有一次修复重试；同一 kind 重复拒绝不再重试，最终按原错误抛出。
- provider 只报 `modality_not_supported` 不带可读类型 → 全部媒体一次性降级。
- 无媒体请求、无该错误的请求：路径不变。
- `supportsPdf=false` 的声明路径行为不变（投影仍发生在 runModelTextRequest 的
  capability projection，不经过本修复）。
