import { createToolCallId, type ModelToolCall } from "../deps.js";

/**
 * 本地/自托管 openai-compatible 端点上，模型可能把 Hermes/Qwen 风格的工具调用
 * 以纯文本输出（服务端没有把它提取成结构化 tool_calls）。turn step 在
 * `executableToolCalls` 为空时调用这里，把文本标记合成为 ModelToolCall，
 * 走既有执行管线——已注册名正常执行，未注册名产出 Tool not found 错误结果，
 * 两种情况都让模型收到应答继续推理，而不是把 turn 静默终止。
 * 见 docs/model-text-tool-call-recovery.md。
 */

export const MAX_TEXT_MARKUP_TOOL_CALLS = 8;

// 只认完整闭合块；流被 length 截断的残块不恢复（续写路径已先行处理）。
const TOOL_CALL_BLOCK_PATTERN = /<tool_call>([\s\S]*?)<\/tool_call>/g;
const FUNCTION_NAME_PATTERN = /<function\s*=\s*([^>\s]+)\s*>/;
// 参数闭合宽松匹配：模型会错写 </name>，或省略闭合直接接下一个字段。
const PARAMETER_PATTERN =
  /<parameter\s*=\s*([^>\s]+)\s*>([\s\S]*?)(?=<\/parameter>|<\/name>|<parameter\s*=|<\/function>|<\/tool_call>)/g;

export function extractTextMarkupToolCalls(text: string): ModelToolCall[] {
  const toolCalls: ModelToolCall[] = [];
  for (const match of text.matchAll(TOOL_CALL_BLOCK_PATTERN)) {
    const toolCall = parseTextMarkupToolCall(match[1] ?? "");
    if (!toolCall) continue;
    toolCalls.push(toolCall);
    if (toolCalls.length >= MAX_TEXT_MARKUP_TOOL_CALLS) break;
  }
  return toolCalls;
}

function parseTextMarkupToolCall(block: string): ModelToolCall | undefined {
  const trimmed = block.trim();
  if (trimmed.startsWith("{")) {
    return parseJsonMarkupToolCall(trimmed);
  }
  return parseFunctionMarkupToolCall(trimmed);
}

// <function=NAME><parameter=K>V</parameter>…</function>
function parseFunctionMarkupToolCall(block: string): ModelToolCall | undefined {
  const name = block.match(FUNCTION_NAME_PATTERN)?.[1]?.trim();
  if (!name) return undefined;
  const input: Record<string, unknown> = {};
  for (const match of block.matchAll(PARAMETER_PATTERN)) {
    const key = match[1]?.trim();
    if (!key) continue;
    input[key] = match[2]?.trim() ?? "";
  }
  return { id: createToolCallId(), name, input };
}

// {"name": "X", "arguments": {...}} —— Hermes JSON 变体。
function parseJsonMarkupToolCall(block: string): ModelToolCall | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimTrailingMarkup(block));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) return undefined;
  return { id: createToolCallId(), name, input: readJsonMarkupInput(record) };
}

function readJsonMarkupInput(record: Record<string, unknown>): unknown {
  const raw = record.arguments ?? record.parameters ?? record.input ?? record.args ?? {};
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function trimTrailingMarkup(value: string): string {
  return value.replace(/<\/function>\s*$/, "").trim();
}
