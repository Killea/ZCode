import { memo, useCallback } from "react";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";

interface V4ComposerGlobalMemorySwitchProps {
  /** 当前开关状态：true = 本次消息携带全局（跨工作区）记忆。 */
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/**
 * Composer 底部的"全局记忆"逐条 opt-in 开关。仅在总开关开启时由宿主渲染。
 * 语义是"只影响下一条消息"：默认关闭，用户临时打开后发送一次，发送成功自动复位为关闭。
 * 直接用文字标注当前状态（"本次携带全局记忆" / "本次不带全局记忆"），比图标更直观。
 */
function V4ComposerGlobalMemorySwitchImpl({
  checked,
  onChange,
  disabled,
}: V4ComposerGlobalMemorySwitchProps) {
  const { intl } = useZCodeIntl();
  const title = intl.formatMessage({ id: "chat.toolbar.globalMemory.label" });
  const text = intl.formatMessage({
    id: checked
      ? "chat.toolbar.globalMemory.labelOn"
      : "chat.toolbar.globalMemory.labelOff",
  });
  const description = intl.formatMessage({
    id: checked ? "chat.toolbar.globalMemory.tooltipOn" : "chat.toolbar.globalMemory.tooltipOff",
  });
  const handleToggle = useCallback(() => {
    if (disabled) return;
    onChange(!checked);
  }, [checked, disabled, onChange]);
  return (
    <ControlHintTooltip title={title} description={description}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-pressed={checked}
        aria-label={title}
        data-testid="v4-composer-global-memory-switch"
        data-composer-collapse-priority="3"
        onClick={handleToggle}
        className={cn(
          "group/global-memory h-7 w-auto whitespace-nowrap rounded-lg px-2",
          checked
            ? "bg-accent text-primary hover:bg-accent hover:text-primary"
            : "text-foreground-subtle hover:text-foreground-subtle",
        )}
      >
        {text}
      </Button>
    </ControlHintTooltip>
  );
}

export const V4ComposerGlobalMemorySwitch = memo(V4ComposerGlobalMemorySwitchImpl);
