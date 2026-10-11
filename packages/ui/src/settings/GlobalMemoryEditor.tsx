import { useCallback, useEffect, useRef, useState } from "react";
import { Save } from "lucide-react";
import { type IMemoryService } from "@zcode/services";
import {
  TID_SETTINGS_MEMORY_GLOBAL_EDITOR,
  TID_SETTINGS_MEMORY_GLOBAL_SAVE,
} from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";
import { runUserActionAsync } from "@/lib/userActionTelemetry.js";
import { Button } from "@/components/ui/button.js";
import { Progress } from "@/components/ui/progress.js";
import { toast } from "@/components/ui/toast.js";
import { Textarea } from "@/components/ui/textarea.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";

type GlobalMemoryEditorService = Pick<
  IMemoryService,
  "readGlobalMemoryFile" | "writeGlobalMemoryFile"
>;

/** 全局（跨工作区）记忆的字符上限（中文每字计 1）；与服务层/注入层常量保持一致。 */
const GLOBAL_MEMORY_CHARACTER_LIMIT = 2048;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 全局记忆编辑器：加载/编辑/保存 `~/.zcode/cli/memories/global/MEMORY.md`。
 * 实时显示字符数与占比进度条；超过 2048 字符时禁用保存并将进度条标红；Ctrl/Cmd+S 保存。
 * `disabled`（总开关关闭）时编辑器只读（仍可预览已存内容），保存按钮禁用。
 */
export function GlobalMemoryEditor({
  memoryService,
  disabled,
}: {
  memoryService: GlobalMemoryEditorService;
  disabled: boolean;
}) {
  const { intl } = useZCodeIntl();
  const [loaded, setLoaded] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const loadVersionRef = useRef(0);

  const load = useCallback(async () => {
    const version = loadVersionRef.current + 1;
    loadVersionRef.current = version;
    setLoading(true);
    try {
      const result = await memoryService.readGlobalMemoryFile();
      if (loadVersionRef.current !== version) {
        return;
      }
      setLoaded(result.content);
      setDraft(result.content);
    } catch (error) {
      if (loadVersionRef.current !== version) {
        return;
      }
      logger.warn("[GlobalMemoryEditor] 读取全局记忆失败", {
        error: getErrorMessage(error),
      });
      toast(intl.formatMessage({ id: "settings.memory.global.loadFailed" }));
    } finally {
      if (loadVersionRef.current === version) {
        setLoading(false);
      }
    }
  }, [intl, memoryService]);

  useEffect(() => {
    setLoading(true);
    setLoaded(null);
    setDraft("");
    void load();
  }, [load]);

  const handleSave = useCallback(async () => {
    if (disabled || draft.length > GLOBAL_MEMORY_CHARACTER_LIMIT) {
      return;
    }
    setSaving(true);
    try {
      await runUserActionAsync({
        input: {
          featureId: "settings.memory",
          action: "save_global_memory",
          trigger: "button",
        },
        operation: async () => {
          await memoryService.writeGlobalMemoryFile({ content: draft });
        },
        completed: { resultSource: "platform_result" },
        failureStage: "global_memory_save",
      });
      setLoaded(draft);
      toast(intl.formatMessage({ id: "settings.memory.global.saved" }));
    } catch (error) {
      logger.warn("[GlobalMemoryEditor] 保存全局记忆失败", {
        error: getErrorMessage(error),
      });
      toast(intl.formatMessage({ id: "settings.memory.global.saveFailed" }));
    } finally {
      setSaving(false);
    }
  }, [disabled, draft, intl, memoryService]);

  const charCount = draft.length;
  const overLimit = charCount > GLOBAL_MEMORY_CHARACTER_LIMIT;
  const percent = Math.min(100, Math.round((charCount / GLOBAL_MEMORY_CHARACTER_LIMIT) * 100));
  const dirty = loaded !== null && draft !== loaded;
  const canSave = !disabled && !loading && !saving && !overLimit && dirty;

  return (
    <div className="space-y-3 px-4 py-3">
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            if (canSave) {
              void handleSave();
            }
          }
        }}
        spellCheck={false}
        disabled={disabled || loading || saving}
        placeholder={intl.formatMessage({ id: "settings.memory.global.empty" })}
        className="min-h-48 w-full text-ui-base"
        aria-label={intl.formatMessage({ id: "settings.memory.global.editorLabel" })}
        data-testid={TID_SETTINGS_MEMORY_GLOBAL_EDITOR}
      />
      <div className="flex items-center gap-2">
        <Progress
          value={percent}
          className="h-1.5 w-24"
          indicatorClassName={overLimit ? "bg-destructive" : undefined}
        />
        <span
          className={cn("text-ui-base", overLimit ? "text-destructive" : "text-foreground-subtle")}
        >
          {intl.formatMessage(
            { id: "settings.memory.global.charCount" },
            { count: charCount, limit: GLOBAL_MEMORY_CHARACTER_LIMIT },
          )}
        </span>
        <Button
          variant="default"
          size="sm"
          disabled={!canSave}
          onClick={() => void handleSave()}
          data-testid={TID_SETTINGS_MEMORY_GLOBAL_SAVE}
        >
          <Save className="size-4" />
          {intl.formatMessage({ id: "settings.memory.global.save" })}
        </Button>
        {dirty && !overLimit ? (
          <span className="text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "settings.memory.global.unsaved" })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
