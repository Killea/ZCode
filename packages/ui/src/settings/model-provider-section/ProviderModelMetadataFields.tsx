import { CheckIcon } from "lucide-react";
import { useRef, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";
import { isImeComposingKeyEvent } from "@/lib/imeComposition.js";
import { modelEditorControlStyle } from "@/settings/model-provider-section/modelEditorControlStyle.js";
import { ModelConfigInputLabel } from "@/settings/model-provider-section/ModelConfigHelp.js";

export function BooleanModelOption({
  label,
  selected,
  onToggle,
  overridden = false,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
  overridden?: boolean;
}) {
  return (
    <Button
      type="button"
      role="checkbox"
      variant="outline"
      size="lg"
      aria-checked={selected}
      data-selected={selected}
      data-model-boolean-option="true"
      data-model-capability-option="true"
      data-personal-override={overridden}
      className={cn(
        "gap-2 disabled:opacity-100",
        "px-3",
        modelEditorControlStyle(overridden, selected),
      )}
      onClick={onToggle}
    >
      <ModelOptionCheckbox selected={selected} />
      <span>{label}</span>
    </Button>
  );
}

/** 外层按钮负责完整点击与键盘语义；指示框不可再嵌一个可聚焦控件。 */
export function ModelOptionCheckbox({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-model-option-checkbox="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-sm border",
        // 边框不能跟随勾号的反色，否则选中后框体出现反色描边；与系统 Checkbox 使用相同颜色。
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input-border bg-input",
      )}
    >
      {selected ? <CheckIcon className="size-3" /> : null}
    </span>
  );
}

function selectInputText(event: Pick<FocusEvent<HTMLInputElement>, "currentTarget">) {
  event.currentTarget.select();
}

/**
 * 流式空闲超时（秒）数字输入。输入法组合跟踪必须按字段持有：复用外层共享 ref 会让
 * 任一字段的候选确认 Enter 状态泄漏到别的字段。
 */
export function StreamIdleTimeoutField({
  inputId,
  value,
  overridden = false,
  placeholder,
  onChange,
  onCommit,
}: {
  inputId: string;
  value: string;
  overridden?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  const compositionActiveRef = useRef(false);
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    // 输入法候选确认也会发出 Enter；组合状态按字段本地跟踪。
    if (
      isImeComposingKeyEvent({
        compositionActive: compositionActiveRef.current,
        nativeEvent: event.nativeEvent,
      })
    ) {
      return;
    }
    event.preventDefault();
    onCommit();
  };
  return (
    <div>
      <div className="mb-1 block text-ui-base text-foreground-subtle">
        <ModelConfigInputLabel field="streamIdleTimeout" htmlFor={inputId} />
      </div>
      <Input
        {...TECHNICAL_INPUT_ATTRIBUTES}
        id={inputId}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        size="lg"
        value={value}
        data-personal-override={overridden}
        className={modelEditorControlStyle(overridden)}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onFocus={selectInputText}
        onCompositionStart={() => {
          compositionActiveRef.current = true;
        }}
        onCompositionEnd={() => {
          compositionActiveRef.current = false;
        }}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}

export function JsonSlotEditor({
  label,
  labelHelp,
  value,
  effectiveValue,
  overridden = false,
  onChange,
}: {
  label: string;
  labelHelp?: ReactNode;
  value: string;
  effectiveValue?: string;
  overridden?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1" data-model-json-slot="true">
      <div className="mb-1 block text-ui-base text-foreground-subtle">
        {label}
        {labelHelp}
      </div>
      <Textarea
        {...TECHNICAL_INPUT_ATTRIBUTES}
        data-language="json"
        // 共享 Textarea 默认按内容自适应高度，长 Effective JSON placeholder 会撑高整个弹窗。
        // JSON 槽位保持固定高度，超出内容只在输入框内部滚动。
        className={cn(
          "field-sizing-fixed h-32 min-h-32 max-h-32 resize-none overflow-y-auto rounded-lg px-3 py-2 font-mono text-foreground placeholder:text-foreground-subtlest",
          modelEditorControlStyle(overridden),
        )}
        data-personal-override={overridden}
        value={value}
        placeholder={effectiveValue}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
