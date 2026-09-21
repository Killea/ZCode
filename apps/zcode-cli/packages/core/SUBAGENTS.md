# Subagent tool surface

子代理（Agent / Task 启动的 child runtime）的工具面与调用方模型的能力挂钩，不是静态常量。

## 规则

1. **子代理可用工具 ⊆ 调用方模型可见工具。** `AgentRuntimeInternal.getTools(model)` 是
   「当前模型能看到哪些工具」的唯一事实来源；子代理 allowlist（`resolveSubagentToolAllowlist`）
   对**继承全集**（`allowedTools: []` / `["*"]`）与**显式清单**两条路径，都必须先经
   `getTools(callerModel)` 取交集。调用方 model 缺席时退化为全量注册表（旧行为）。
   - `callerModel` 是发起 Agent 调用的父 turn 模型（`SubagentRunOptions.model`，由 Agent
     handler 传入 `context.model`）；不是 child 自己解析出的模型。
   - MCP 工具名（`mcp__*`）不走注册表交集，维持原有的 parent allowlist / snapshot 过滤。
   - `RespondToCoordinator` 在交集之后追加，不受模型过滤影响。
   - 典型场景：`supportsNativeWebSearch: false` 的模型（openai-compatible 本地推理）下，
     `WebSearch` 不在 `getTools(model)` 结果里，子代理显式清单里的 `WebSearch` 同样剔除，
     child 无法注册也无法执行——模型幻觉调用得到 tool_not_found，而非
     `invalid_model_request`（providerKind 无法编码 provider-native web_search）。

2. **Agent / Task 的工具描述是模型可见契约，按调用模型投影。** `ToolEntry.resolveModelContract`
   是已存在的投影缝：`getTools(model)` 对每个 entry 调它。Agent/Task 的描述在投影中
   按 `model.properties.supportsNativeWebSearch` 重建——不支持时 Explore 的
   `(Tools: …)` 清单不含 `WebSearch`，模型连名字都看不到。
   - `context.model` 缺席时输出与今天相同的默认描述（含 WebSearch），保证持久化与
     UI 元数据路径（`getTools()` 无参调用）逐字不变。
   - Task 的描述 = 固定前缀 + Agent 描述；投影只替换 Agent 段，前缀保留。

3. **Explore 显式工具清单的构建与描述渲染共用同一个开关。**
   `buildExploreAllowedTools({ embeddedSearchEnabled, nativeWebSearchSupported })`：
   `nativeWebSearchSupported === false` 时从两份内置清单中剔除 `WebSearch`；
   `formatExploreAllowedToolsForAgentDescription` / `formatAgentProfilesForPrompt` /
   `buildAgentProviderDescription` 透传同一参数，allowlist 与文本描述必然一致。
   端口回调 `ExploreSubagentPortOptions.getAllowedTools` 扩展为
   `(profile, context?: { model?: Model })`，runner 在计算 `request.allowedTools`
   与 `SubagentSpawned` 事件载荷时传入 `runOptions.model`。

## 内建 general-purpose system prompt

`buildGeneralPurposeSystemPrompt()` 是内建 general-purpose profile 的 system prompt
唯一来源（可被用户级 `~/.zcode/cli/agents/general-purpose.md` 同名覆盖）。

组成规则：

- **角色与委托语义**：子代理由父代理派发任务、独立执行；最终 assistant 文本是唯一回传
  通道，父代理只能读到它（看不到 child 的工具调用与思考）。报告必须先讲结果。
- **工作纪律**：任务做完整但不镀金；自主执行、不能中途问用户（歧义处选合理方案并在
  报告中注明假设）；首个工具调用前一句话说明计划；优先专用文件/搜索工具；无依赖的
  工具调用并行；权限被拒后调整做法而非原样重试。
- **编辑纪律**：Edit 前必须先 Read（未读先改会失败）；代码风格贴合周围代码；注释只写
  代码自身无法表达的约束；不创建非必要文件、不创建报告/文档文件（最终消息即报告）；
  删除或覆盖前先查看目标，与描述矛盾时上报而非继续。
- **完成前验证**：用最便宜的真实检查验证（编译、跑测试、执行脚本）；如实报告验证结果，
  失败不粉饰；结束前自查最后一段——若仍是计划/承诺则继续干活，只在完成或真正被
  阻塞时结束。
- **写作方式**：面向弱指令遵循模型的显式过程化指令，祈使句、可执行、不依赖模型自行
  领悟；本地实测（27B 级本地推理）证实提示词厚度与执行质量强相关，保持完整四段结构，
  不为省 token 而砍流程规则。
- **不包含**：主会话专有内容（桌面渲染指令、::code-comment、memory 文件管理、session
  级语义、child 没有的工具名）；runtime 会另行追加的内容（common Notes 段、env 段、
  persistent memory 提示）不重复书写，避免双份指令漂移。

## 所有者与事件顺序

- 模型可见工具的唯一 owner：`AgentRuntimeInternal.getTools`（registry → runtime 可见性
  → `shouldExposeWebSearch(model)` → `resolveModelContract` 投影）。子代理不维护第二份
  模型能力判断。
- 事件顺序：`getAllowedTools`（生成 `request.allowedTools`）→ `resolveSubagentToolAllowlist`
  （与父可见工具取交 + disallow 规则）→ child `registerBuiltInTools`（allowlist 过滤注册）
  → child turn `getTools(childModel)`（child 自身模型再过滤一次，双重保护）。

## 验收场景

- `supportsNativeWebSearch: false` 的调用模型：Explore allowlist、Agent 描述、Task 描述
  均不含 `WebSearch`；模型仍幻觉调用 `WebSearch` 时 child 报 tool_not_found。
- `supportsNativeWebSearch: true` 或未传 model：行为与现状逐字一致。
- 自定义 profile 显式 `tools` 中含 `WebSearch` 且模型不支持：同样被交集剔除。
