import { memo } from "react";
import { InfoIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@/components/ui/hover-card.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/** 单条 prompt 预览的最大字符数（超出截断并加省略号）。 */
const MAX_PREVIEW_CHARS = 120;

export interface ComposerRecentPromptItem {
  /** 稳定 key（row 身份），用于 React 列表。 */
  key: string;
  /** 已去除引擎尾注的 prompt 正文（未截断，展示时再截断）。 */
  text: string;
}

interface V4ComposerRecentPromptsHintProps {
  /** 最近的用户 prompt，时间正序（旧→新），最多 3 条；为空时整枚图标隐藏。 */
  items: readonly ComposerRecentPromptItem[];
}

/** 折叠空白并按最大长度截断，得到 hover 面板里的紧凑单行预览。 */
function toPreview(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  if (flat.length <= MAX_PREVIEW_CHARS) return flat;
  return `${flat.slice(0, MAX_PREVIEW_CHARS).trimEnd()}…`;
}

/**
 * Composer 底部"全局记忆"按钮右侧的 peek 图标：hover 时展示最近 3 条用户 prompt，
 * 免去为确认当前 session 在做什么而往上滚动。会话尚无真实用户输入时整枚隐藏。
 * 只读信息，不随 composer 是否禁用而失效（正忙时最需要回看）。
 */
function V4ComposerRecentPromptsHintImpl({
  items,
}: V4ComposerRecentPromptsHintProps) {
  const { intl } = useZCodeIntl();
  const title = intl.formatMessage({ id: "chat.toolbar.recentPrompts.label" });
  if (items.length === 0) return null;
  return (
    <HoverCard openDelay={150} closeDelay={200}>
      <HoverCardTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={title}
          data-testid="v4-composer-recent-prompts-hint"
          data-composer-collapse-priority="4"
          className="group/recent size-7 rounded-lg p-0 text-foreground-subtle hover:text-foreground"
        >
          <InfoIcon className="size-4" />
        </Button>
      </HoverCardTrigger>
      <HoverCardContent align="start" side="top" className="w-80">
        <p className="mb-2 text-ui-xs font-medium uppercase tracking-wide text-foreground-subtle">
          {title}
        </p>
        <ul className="flex flex-col divide-y divide-foreground/10">
          {items.map((item) => (
            <li
              key={item.key}
              className="break-words py-2 text-ui-sm leading-relaxed text-popover-foreground first:pt-0"
            >
              {toPreview(item.text)}
            </li>
          ))}
        </ul>
      </HoverCardContent>
    </HoverCard>
  );
}

export const V4ComposerRecentPromptsHint = memo(V4ComposerRecentPromptsHintImpl);
