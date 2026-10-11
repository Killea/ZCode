import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input.js";
import { cn } from "@/components/lib/utils.js";
import type { WorkspaceFileTreeEditingSession } from "@/workspace-file-tree/types.js";
import {
  getWorkspaceEntryNameError,
  getWorkspaceEntryRenameSelectionEnd,
} from "@/workspace-file-tree/workspaceFileEdit.js";

/**
 * 文件树行内命名输入框（新建/重命名共用）。
 * Enter 提交、Escape 取消、blur 提交（与 VS Code 一致）；
 * 名称非法时保持编辑态并 toast 提示，由调用方决定是否保留会话。
 */
export function WorkspaceFileTreeEditingInput({
  session,
  invalidMessage,
  onCommit,
  onCancel,
  onInvalid,
}: {
  session: WorkspaceFileTreeEditingSession;
  invalidMessage: string;
  onCommit: (session: WorkspaceFileTreeEditingSession, name: string) => void;
  onCancel: (session: WorkspaceFileTreeEditingSession) => void;
  onInvalid: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState(session.initialName);
  // blur 提交与 Escape 取消会在同一事件中竞争；用 ref 标记已取消，避免 blur 再次提交。
  const cancelledRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    const selectionEnd =
      session.mode === "rename" && session.kind === "file"
        ? getWorkspaceEntryRenameSelectionEnd(session.initialName)
        : session.initialName.length;
    input.setSelectionRange(0, selectionEnd);
  }, [session]);

  const tryCommit = () => {
    const error = getWorkspaceEntryNameError(value);
    if (error) {
      // 非法名称保持编辑态：用户可继续修正或 Escape 退出。
      onInvalid(invalidMessage);
      inputRef.current?.focus();
      return;
    }
    onCommit(session, value.trim());
  };

  return (
    <Input
      ref={inputRef}
      type="text"
      size="default"
      value={value}
      className={cn(
        "h-6 min-w-0 flex-1 rounded-md border-input-border-focused bg-input-focused px-1.5 py-0 text-ui-base",
      )}
      aria-label={invalidMessage}
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={() => {
        if (!cancelledRef.current) {
          tryCommit();
        }
      }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        // 行容器的 Enter/方向键/F2/Delete 处理不能吞掉输入框编辑按键。
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          tryCommit();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          cancelledRef.current = true;
          onCancel(session);
        }
      }}
    />
  );
}
