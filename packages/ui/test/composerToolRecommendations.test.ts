import { expect, it } from "vitest";
import {
  buildPromptWithToolRecommendations,
  COMPOSER_MAX_PLUGIN_RECOMMENDATIONS,
  mcpToolSelectionId,
  parsePromptToolRecommendations,
  pluginToolSelectionId,
  resolveComposerToolRecommendations,
  type ComposerToolRecommendation,
} from "../src/v4/composer/composerToolRecommendations.js";
import {
  parseComposerPromptContexts,
  serializeComposerPromptContexts,
} from "../src/v4/composer/composerPromptContexts.js";

const WORKSPACE = { workspacePath: "/ws/proj" };

function makePluginEntry(overrides?: {
  pluginId?: string;
  name?: string;
  enabled?: boolean;
  conflictingPluginIds?: string[];
}) {
  return {
    pluginId: overrides?.pluginId ?? "ctx7@zcode-plugins-official",
    name: overrides?.name ?? "ctx7",
    enabled: overrides?.enabled ?? true,
    conflictingPluginIds: overrides?.conflictingPluginIds ?? [],
  };
}

function makePickableMcp(overrides?: { id?: string; name?: string }) {
  return {
    id: overrides?.id ?? "zcodeagentmcp:ctx7",
    name: overrides?.name ?? "ctx7",
  };
}

it("空选择不追加块（默认逻辑零变化）", () => {
  expect(buildPromptWithToolRecommendations("fix the bug", [])).toBe("fix the bug");
  expect(buildPromptWithToolRecommendations("", [])).toBe("");
});

it("序列化：插件写成 plugin:// 链接，MCP 写成文本行", () => {
  const text = buildPromptWithToolRecommendations("do the thing", [
    { kind: "plugin", pluginId: "ctx7@zcode-plugins-official", label: "ctx7" },
    { kind: "mcp", serverId: "zcodeagentmcp:fs", name: "filesystem" },
  ]);
  expect(text).toMatch(/^do the thing\n\n# Recommended capabilities/);
  expect(text).toMatch(/- Plugin: \[@ctx7\]\(plugin:\/\/ctx7@zcode-plugins-official\)/);
  expect(text).toMatch(/- MCP server: "filesystem"/);
  // runtime reminder 依赖 plugin:// destination 可被 extractPluginReferences 命中
  expect(text).toMatch(/plugin:\/\/ctx7@zcode-plugins-official/);
});

it("序列化：插件 label 含 markdown 特殊字符时转义", () => {
  const text = buildPromptWithToolRecommendations("hi", [
    { kind: "plugin", pluginId: "weird@mp", label: "we]ird" },
  ]);
  expect(text.includes("[@we\\]ird](plugin://weird@mp)")).toBeTruthy();
});

it("解析：剥离尾块并还原条目", () => {
  const text = buildPromptWithToolRecommendations("fix it", [
    { kind: "plugin", pluginId: "ctx7@zcode-plugins-official", label: "ctx7" },
    { kind: "plugin", pluginId: "figma@personal", label: "figma" },
    { kind: "mcp", serverId: "zcodeagentmcp:fs", name: "filesystem" },
  ]);
  const parsed = parsePromptToolRecommendations(text);
  expect(parsed.visibleContent).toBe("fix it");
  expect(parsed.toolRecommendations).toEqual([
    {
      kind: "plugin",
      pluginId: "ctx7@zcode-plugins-official",
      label: "ctx7",
    },
    { kind: "plugin", pluginId: "figma@personal", label: "figma" },
    { kind: "mcp", serverId: "filesystem", name: "filesystem" },
  ]);
});

it("解析：无块时原样返回", () => {
  const parsed = parsePromptToolRecommendations(
    "plain prompt with # heading inside\n\n# Not a tool block",
  );
  expect(parsed.toolRecommendations.length).toBe(0);
  expect(parsed.visibleContent).toBe("plain prompt with # heading inside\n\n# Not a tool block");
});

it("端到端：经 composerPromptContexts 序列化/解析保持五类块顺序", () => {
  const prompt = serializeComposerPromptContexts("hello", {
    codeComments: [],
    conversationSelections: [],
    webElements: [],
    pptxElements: [],
    toolRecommendations: [
      { kind: "plugin", pluginId: "ctx7@mp", label: "ctx7" },
      { kind: "mcp", serverId: "mcp:sentry", name: "sentry" },
    ],
  });
  const parsed = parseComposerPromptContexts(prompt, WORKSPACE);
  expect(parsed.visibleContent).toBe("hello");
  expect(parsed.toolRecommendations).toEqual([
    { kind: "plugin", pluginId: "ctx7@mp", label: "ctx7" },
    { kind: "mcp", serverId: "sentry", name: "sentry" },
  ]);
});

it("resolve：失效条目（禁用/冲突/未知）被丢弃", () => {
  const selected = new Set([
    pluginToolSelectionId("enabled@mp"),
    pluginToolSelectionId("disabled@mp"),
    pluginToolSelectionId("conflicted@mp"),
    pluginToolSelectionId("missing@mp"),
    mcpToolSelectionId("keep"),
    mcpToolSelectionId("gone"),
  ]);
  const resolved = resolveComposerToolRecommendations(
    selected,
    [
      makePluginEntry({ pluginId: "enabled@mp", name: "enabled" }),
      makePluginEntry({ pluginId: "disabled@mp", name: "disabled", enabled: false }),
      makePluginEntry({
        pluginId: "conflicted@mp",
        name: "conflicted",
        conflictingPluginIds: ["other@mp"],
      }),
    ],
    [makePickableMcp({ id: "keep", name: "keep-mcp" })],
  );
  expect(resolved).toEqual([
    { kind: "plugin", pluginId: "enabled@mp", label: "enabled" },
    { kind: "mcp", serverId: "keep", name: "keep-mcp" },
  ]);
});

it("resolve：插件条目超过单轮上限被截断，MCP 不占名额", () => {
  const selected = new Set<string>([mcpToolSelectionId("a")]);
  const plugins = Array.from({ length: COMPOSER_MAX_PLUGIN_RECOMMENDATIONS + 2 }, (_, i) =>
    makePluginEntry({ pluginId: `p${i}@mp`, name: `p${i}` }),
  );
  for (const plugin of plugins) selected.add(pluginToolSelectionId(plugin.pluginId));
  const resolved = resolveComposerToolRecommendations(selected, plugins, [
    makePickableMcp({ id: "a", name: "a" }),
  ]);
  expect(resolved.filter((r) => r.kind === "plugin").length).toBe(COMPOSER_MAX_PLUGIN_RECOMMENDATIONS);
  expect(resolved.filter((r) => r.kind === "mcp").length).toBe(1);
});

it("resolve：空勾选集返回空数组", () => {
  expect(resolveComposerToolRecommendations(new Set(), [makePluginEntry()], [makePickableMcp()])).toEqual([]);
});

it("selectionId 往返：plugin/mcp 前缀互不冲突", () => {
  expect(pluginToolSelectionId("a@b")).toBe("plugin:a@b");
  expect(mcpToolSelectionId("mcp:x")).toBe("mcp:mcp:x");
  const resolved = resolveComposerToolRecommendations(
    new Set(["plugin:a@b", "mcp:mcp:x"]),
    [makePluginEntry({ pluginId: "a@b", name: "a" })],
    [makePickableMcp({ id: "mcp:x", name: "x" })],
  );
  expect(resolved.map((r: ComposerToolRecommendation) => r.kind)).toEqual(["plugin", "mcp"]);
});
