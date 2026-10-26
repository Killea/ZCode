// 用户消息气泡的"推荐能力"chip：Composer Tools Picker 勾选在提交时序列化为
// prompt 尾块（# Recommended capabilities），展示侧由 parseComposerPromptContexts
// 剥离后渲染成这个 pill——与 CodeComment/WebElement 等既有上下文 chip 同壳。
import { PuzzleIcon, ServerIcon } from "lucide-react";
import type { AttachmentHoverCardContentProps } from "@/components/ai-elements/attachments.js";
import { PluginIcon } from "@/components/PluginIcon.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ContextAttachmentPill } from "@/v4/composer/ContextAttachmentPill.js";
import type { ComposerToolRecommendation } from "@/v4/composer/composerToolRecommendations.js";

export function ToolRecommendationChip({
  recommendations,
  contentAlign = "start",
}: {
  recommendations: readonly ComposerToolRecommendation[];
  contentAlign?: AttachmentHoverCardContentProps["align"];
}) {
  const { intl } = useZCodeIntl();
  if (recommendations.length === 0) return null;
  const label = intl.formatMessage(
    { id: "chat.tools.recommended.label" },
    { count: String(recommendations.length) },
  );
  return (
    <ContextAttachmentPill
      contentAlign={contentAlign}
      icon={<PuzzleIcon className="size-4 shrink-0 text-foreground-subtle" />}
      label={label}
      removeLabel={intl.formatMessage({ id: "chat.toolbar.tools.clear" })}
      triggerProps={{
        "data-tool-recommendation-count": recommendations.length,
      }}
    >
      {recommendations.map((recommendation) => (
        <div
          key={
            recommendation.kind === "plugin"
              ? `plugin:${recommendation.pluginId}`
              : `mcp:${recommendation.name}`
          }
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-ui-base"
        >
          {recommendation.kind === "plugin" ? (
            <>
              <PluginIcon
                pluginId={recommendation.pluginId}
                className="size-4 shrink-0 rounded"
                iconClassName="size-3"
              />
              <span className="min-w-0 flex-1 truncate">{recommendation.label}</span>
              <span className="shrink-0 text-ui-xs text-foreground-subtlest">
                {intl.formatMessage({ id: "chat.tools.recommended.kind.plugin" })}
              </span>
            </>
          ) : (
            <>
              <ServerIcon className="size-4 shrink-0 text-foreground-subtle" />
              <span className="min-w-0 flex-1 truncate">{recommendation.name}</span>
              <span className="shrink-0 text-ui-xs text-foreground-subtlest">
                {intl.formatMessage({ id: "chat.tools.recommended.kind.mcp" })}
              </span>
            </>
          )}
        </div>
      ))}
    </ContextAttachmentPill>
  );
}
