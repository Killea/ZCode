import assert from "node:assert/strict";
import test from "node:test";
import {
  extractTextMarkupToolCalls,
  MAX_TEXT_MARKUP_TOOL_CALLS,
} from "../src/runtime/helpers/text-tool-call-recovery.js";

// 本地 openai-compatible 端点上，模型把 <tool_call> 以纯文本输出时
// 服务端不会提取成结构化 tool_calls。这些测试锁住「文本标记 → 合成
// ModelToolCall」的解析契约，保证未注册工具（如 WebFetch）能走 registry-miss
// 错误回灌而不是让 turn 静默终止。

const WEBFETCH_MARKUP = `<tool_call>
<function=WebFetch>
<parameter=url>
https://example.com/docs.json
</parameter>
<parameter=prompt>
List the entries of the enroll section.
</parameter>
</function>
</tool_call>`;

test("parses function-markup tool call with parameters", () => {
  const calls = extractTextMarkupToolCalls(WEBFETCH_MARKUP);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.name, "WebFetch");
  assert.equal(calls[0]!.input.url, "https://example.com/docs.json");
  assert.equal(calls[0]!.input.prompt, "List the entries of the enroll section.");
  assert.ok(calls[0]!.id.startsWith("tool_"));
});

test("tolerates malformed parameter close tags", () => {
  // 模型会把 </parameter> 错写成 </name>，或直接省略闭合。
  const markup = `<tool_call>
<function=WebFetch>
<parameter=url>
https://example.com
</name>
<parameter=prompt>
hi
</function>
</tool_call>`;
  const calls = extractTextMarkupToolCalls(markup);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.input.url, "https://example.com");
  assert.equal(calls[0]!.input.prompt, "hi");
});

test("parses hermes JSON-variant tool call", () => {
  const calls = extractTextMarkupToolCalls(
    `<tool_call>{"name":"WebFetch","arguments":{"url":"https://example.com"}}</tool_call>`,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.name, "WebFetch");
  assert.deepEqual(calls[0]!.input, { url: "https://example.com" });
});

test("parses hermes variant with JSON-string arguments", () => {
  const calls = extractTextMarkupToolCalls(
    `<tool_call>{"name":"Read","arguments":"{\\"file_path\\":\\"/tmp/a\\"}"}</tool_call>`,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.input, { file_path: "/tmp/a" });
});

test("multiple markup blocks produce multiple calls", () => {
  const calls = extractTextMarkupToolCalls(
    `${WEBFETCH_MARKUP}\nsome text\n<tool_call><function=Read><parameter=file_path>/a</parameter></function></tool_call>`,
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.name, "Read");
});

test("ignores truncated blocks without closing tag", () => {
  const calls = extractTextMarkupToolCalls(
    `prefix <tool_call>\n<function=WebFetch>\n<parameter=url>\nhttps://example.com`,
  );
  assert.equal(calls.length, 0);
});

test("plain text produces no calls", () => {
  assert.equal(extractTextMarkupToolCalls("just an answer, no tools").length, 0);
  assert.equal(extractTextMarkupToolCalls("").length, 0);
});

test("block with no parseable name is skipped", () => {
  const calls = extractTextMarkupToolCalls(`<tool_call><parameter=url>x</parameter></tool_call>`);
  assert.equal(calls.length, 0);
});

test("cap bounds pathological output", () => {
  const block = `<tool_call><function=WebFetch></function></tool_call>`;
  const calls = extractTextMarkupToolCalls(block.repeat(20));
  assert.equal(calls.length, MAX_TEXT_MARKUP_TOOL_CALLS);
});
