import assert from "node:assert/strict";
import test from "node:test";
import type { Model } from "@zcode/contracts";
import {
  buildExploreAllowedTools,
  formatExploreAllowedToolsForAgentDescription,
} from "../src/subagent/explore-tools.js";
import { createAgentToolEntry, createTaskToolEntry } from "../src/tool/handlers/agent.js";

// 只构造投影需要的 properties；ToolExecutionModelContext 不消费 Model 的其他成员。
function modelWithNativeWebSearch(supported: boolean): Model {
  return { properties: { supportsNativeWebSearch: supported } } as Model;
}

test("buildExploreAllowedTools drops WebSearch when the caller model lacks native support", () => {
  for (const embeddedSearchEnabled of [false, true]) {
    const tools = buildExploreAllowedTools({
      embeddedSearchEnabled,
      nativeWebSearchSupported: false,
    });
    assert.ok(!tools.includes("WebSearch"));
    assert.ok(tools.includes("WebFetch"));
  }
});

test("buildExploreAllowedTools keeps WebSearch by default and when supported", () => {
  assert.ok(buildExploreAllowedTools().includes("WebSearch"));
  assert.ok(
    buildExploreAllowedTools({ nativeWebSearchSupported: true }).includes("WebSearch"),
  );
});

test("formatExploreAllowedToolsForAgentDescription mirrors the allowlist", () => {
  const rendered = formatExploreAllowedToolsForAgentDescription({
    nativeWebSearchSupported: false,
  });
  assert.ok(!rendered.split(", ").includes("WebSearch"));
  assert.ok(
    formatExploreAllowedToolsForAgentDescription().split(", ").includes("WebSearch"),
  );
});

test("Agent description projection removes WebSearch for unsupported models", () => {
  const entry = createAgentToolEntry();
  const projected = entry.resolveModelContract?.({
    model: modelWithNativeWebSearch(false),
  });
  assert.ok(projected?.description !== undefined);
  assert.ok(!projected.description.includes("WebSearch"));
});

test("Agent description projection keeps WebSearch for supported models and absent model", () => {
  const entry = createAgentToolEntry();
  const supported = entry.resolveModelContract?.({
    model: modelWithNativeWebSearch(true),
  });
  assert.ok(supported?.description?.includes("WebSearch"));
  // 无模型上下文（持久化/UI 元数据路径）保持默认描述逐字不变。
  const absent = entry.resolveModelContract?.({});
  assert.equal(absent?.description, entry.metadata.description);
});

test("Task projection keeps the alias prefix while rebuilding the Agent body", () => {
  const entry = createTaskToolEntry();
  const projected = entry.resolveModelContract?.({
    model: modelWithNativeWebSearch(false),
  });
  assert.ok(projected?.description !== undefined);
  assert.ok(
    projected.description.startsWith(
      "Claude Code-compatible alias for the Agent tool.",
    ),
  );
  assert.ok(!projected.description.includes("WebSearch"));
});
