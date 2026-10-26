// Composer "MCP & 插件" 选择器（Tools Picker）的纯逻辑层。
// 契约见 docs/composer-tools-picker.md：
// - 选择器勾选集是 composer 组件态（逐条 opt-in，发送成功复位），本模块只负责
//   提交瞬间的 resolve（丢弃已失效条目）与 prompt 尾块的序列化/解析。
// - 插件行序列化为标准 `[@label](plugin://stable-id)` 链接：runtime 的
//   extractPluginReferences 扫描全文无位置约束，自动触发既有 plugin reminder
//   （live 能力清单，"推荐但不强制"语义），CLI/协议零改动。
// - 独立 MCP 行是纯文本引导（无 mcp:// 协议；工具本就注册在 session 工具面）。
import type { ZCodeMcpServer, ZCodePluginReferenceCatalogEntry } from "@zcode/shared";

// 与 apps/zcode-cli plugin-reference/references.ts 的 MAX_PLUGIN_REFERENCES_PER_TURN 保持一致；
// UI 侧独立持有（不能跨包引 runtime 实现），超上限时 runtime 会 fail-closed 截断，
// picker 在第 8 个勾选后禁用其余插件行，避免静默失效。
export const COMPOSER_MAX_PLUGIN_RECOMMENDATIONS = 8;

export type ComposerToolRecommendation =
  | { kind: "plugin"; pluginId: string; label: string }
  | { kind: "mcp"; serverId: string; name: string };

export function pluginToolSelectionId(pluginId: string): string {
  return `plugin:${pluginId}`;
}

export function mcpToolSelectionId(serverId: string): string {
  return `mcp:${serverId}`;
}

/**
 * Picker 行模型。插件行与独立 MCP 行统一成同一形状，picker 只负责渲染。
 */
export interface ComposerToolPickerEntry {
  selectionId: string;
  kind: "plugin" | "mcp";
  /** 勾选项身份；插件 = stableId（name@marketplace），MCP = store server id。 */
  identity: string;
  /** 展示名（插件按 locale resolve 过；提示块里写 canonical name）。 */
  label: string;
  /** canonical 名称：写入 prompt 块（插件 mention label / MCP name），不随 locale。 */
  canonicalName: string;
  description?: string;
  icon?: string;
  disabled?: boolean;
  disabledReason?: string;
  /** 插件行详情：能力计数与来源；MCP 行详情：transport/scope/status。 */
  detailLines: readonly string[];
}

/**
 * 发送那一刻按最新 catalog/store 解析勾选集；失效条目不写入提示块。
 * `mcpServers` 必须是已经过 enabled/来源/scope/workspace 守卫过滤的
 * selectPickableMcpServers 结果——picker 与 resolve 读同一份列表。
 */
export function resolveComposerToolRecommendations(
  selectedIds: ReadonlySet<string>,
  plugins: readonly Pick<
    ZCodePluginReferenceCatalogEntry,
    "pluginId" | "name" | "enabled" | "conflictingPluginIds"
  >[],
  mcpServers: readonly Pick<ZCodeMcpServer, "id" | "name">[],
): ComposerToolRecommendation[] {
  const recommendations: ComposerToolRecommendation[] = [];
  let pluginCount = 0;
  for (const selectionId of selectedIds) {
    if (selectionId.startsWith("plugin:")) {
      const pluginId = selectionId.slice("plugin:".length);
      const entry = plugins.find(
        (candidate) => candidate.pluginId === pluginId && candidate.enabled,
      );
      // 与 mention provider 的 V1 fail-closed 一致：冲突插件不可推荐。
      if (!entry || entry.conflictingPluginIds.length > 0) continue;
      if (pluginCount >= COMPOSER_MAX_PLUGIN_RECOMMENDATIONS) continue;
      pluginCount += 1;
      recommendations.push({ kind: "plugin", pluginId: entry.pluginId, label: entry.name });
      continue;
    }
    if (selectionId.startsWith("mcp:")) {
      const serverId = selectionId.slice("mcp:".length);
      const server = mcpServers.find((candidate) => candidate.id === serverId);
      if (!server) continue;
      recommendations.push({ kind: "mcp", serverId: server.id, name: server.name });
    }
  }
  return recommendations;
}

const TOOL_RECOMMENDATIONS_HEADER =
  "# Recommended capabilities (the user suggests these for this turn — use only when relevant, not required):";

function escapeMarkdownLabel(label: string): string {
  return label.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function escapeMarkdownDestination(destination: string): string {
  return destination.replaceAll("\\", "\\\\").replaceAll(">", "\\>");
}

function buildPluginRecommendationLine(recommendation: {
  pluginId: string;
  label: string;
}): string {
  return `- Plugin: [@${escapeMarkdownLabel(recommendation.label)}](plugin://${escapeMarkdownDestination(
    recommendation.pluginId,
  )})`;
}

function buildMcpRecommendationLine(recommendation: { name: string }): string {
  return `- MCP server: "${recommendation.name}"`;
}

function buildToolRecommendationsBlock(
  recommendations: readonly ComposerToolRecommendation[],
): string {
  if (recommendations.length === 0) return "";
  const lines = recommendations.map((recommendation) =>
    recommendation.kind === "plugin"
      ? buildPluginRecommendationLine(recommendation)
      : buildMcpRecommendationLine(recommendation),
  );
  return `${TOOL_RECOMMENDATIONS_HEADER}\n\n${lines.join("\n")}`;
}

/**
 * 把推荐能力块追加到 prompt 尾部（第 5 类 context 块，排在既有四类之后）。
 * 空选择 → 原样返回，"默认不选择走默认逻辑"。
 */
export function buildPromptWithToolRecommendations(
  text: string,
  recommendations: readonly ComposerToolRecommendation[],
): string {
  const content = text.trimEnd();
  const block = buildToolRecommendationsBlock(recommendations);
  if (!block) {
    return content.trim();
  }
  return `${content}${content ? "\n\n" : ""}${block}`.trim();
}

const TOOL_RECOMMENDATIONS_BLOCK_PATTERN =
  /(?:^|\n\n)# Recommended capabilities \(the user suggests these for this turn[^\n]*\):\s*\n\n([\s\S]*?)\s*$/;

const PLUGIN_LINE_PATTERN = /^- Plugin:\s*\[(?:\\.|[^\\\]])*\]\(plugin:\/\/([^)\s]+)\)/;
const MCP_LINE_PATTERN = /^- MCP server:\s*"([^"]+)"/;

export interface ParsedToolRecommendations {
  visibleContent: string;
  toolRecommendations: ComposerToolRecommendation[];
}

/**
 * 尾块解析（展示侧剥离）。只识别 prompt 末尾块，顺序契约：
 * 本块是序列化的最末块，因此 parseComposerPromptContexts 中最先运行。
 * 行内插件链接只提取 pluginId（label 不回读——身份只在 destination）；
 * MCP 行提取引号内服务器名。无法解析的行静默丢弃，不暴露原始块。
 */
export function parsePromptToolRecommendations(content: string): ParsedToolRecommendations {
  const blockMatch = TOOL_RECOMMENDATIONS_BLOCK_PATTERN.exec(content);
  if (!blockMatch || blockMatch.index < 0) {
    return { visibleContent: content, toolRecommendations: [] };
  }
  const rawBlock = blockMatch[1];
  if (rawBlock === undefined) {
    return { visibleContent: content, toolRecommendations: [] };
  }
  const toolRecommendations: ComposerToolRecommendation[] = [];
  for (const rawLine of rawBlock.split("\n")) {
    const line = rawLine.trim();
    const pluginMatch = PLUGIN_LINE_PATTERN.exec(line);
    if (pluginMatch?.[1]) {
      const pluginId = pluginMatch[1];
      toolRecommendations.push({
        kind: "plugin",
        pluginId,
        // 展示侧 label 回读 destination 的 name 段即可（id = name@marketplace）。
        label: pluginId.split("@")[0] ?? pluginId,
      });
      continue;
    }
    const mcpMatch = MCP_LINE_PATTERN.exec(line);
    if (mcpMatch?.[1]) {
      const name = mcpMatch[1];
      toolRecommendations.push({ kind: "mcp", serverId: name, name });
    }
  }
  return {
    visibleContent: content.slice(0, blockMatch.index).trimEnd(),
    toolRecommendations,
  };
}
