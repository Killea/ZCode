// 用户消息气泡的"携带全局记忆"chip：记忆选择随 input intent 持久化在 userInput row 上，
// 展示侧按 id 解析当前名称；与推荐能力/网页元素等上下文 chip 同壳。
import { BrainIcon } from "lucide-react";
import { GLOBAL_MEMORY_DEFAULT_ID } from "@zcode/services";
import type { AttachmentHoverCardContentProps } from "@/components/ai-elements/attachments.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ContextAttachmentPill } from "@/v4/composer/ContextAttachmentPill.js";
import { useGlobalMemoryDisplayNames } from "@/v4/composer/useGlobalMemoryDisplayNames.js";

export function GlobalMemoryChip({
  memoryIds,
  contentAlign = "start",
}: {
  memoryIds: readonly string[];
  contentAlign?: AttachmentHoverCardContentProps["align"];
}) {
  const { intl } = useZCodeIntl();
  const names = useGlobalMemoryDisplayNames(memoryIds);
  if (memoryIds.length === 0) return null;

  const label = intl.formatMessage(
    { id: "chat.memory.included.label" },
    { count: String(memoryIds.length) },
  );
  return (
    <ContextAttachmentPill
      contentAlign={contentAlign}
      icon={<BrainIcon className="size-4 shrink-0 text-foreground-subtle" />}
      label={label}
      removeLabel={intl.formatMessage({ id: "chat.memory.included.clear" })}
      triggerProps={{
        "data-global-memory-count": memoryIds.length,
      }}
    >
      {memoryIds.map((memoryId) => {
        const resolvedName = names.get(memoryId);
        const displayName =
          memoryId === GLOBAL_MEMORY_DEFAULT_ID &&
          (resolvedName === undefined || resolvedName === memoryId)
            ? intl.formatMessage({ id: "chat.toolbar.memory.defaultName" })
            : (resolvedName ?? memoryId);
        return (
          <div
            key={memoryId}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-ui-base"
          >
            <BrainIcon className="size-4 shrink-0 text-foreground-subtle" />
            <span className="min-w-0 flex-1 truncate">{displayName}</span>
          </div>
        );
      })}
    </ContextAttachmentPill>
  );
}
