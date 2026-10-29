import { useMemo } from "react";
import { Cloud, LoaderIcon } from "lucide-react";
import type { WindowHostControllerTaskListItem } from "@zcode/services";
import {
  TID_HEADER_RUNNING_TASK,
  TID_HEADER_RUNNING_TASKS,
  TID_HEADER_RUNNING_TASKS_OVERFLOW,
  testId,
} from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useGlobalTaskList } from "@/hooks/useGlobalTaskList.js";
import { useOptionalTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";
import { buildTaskEntityKey, buildTaskWorkspaceKey } from "@/lib/taskQueryCache.js";
import {
  getTaskListAttention,
  isTaskListRowRunning,
  type TaskListMetaWithActivity,
} from "@/v4/taskListRowActivity.js";
import { WINDOWS_CAPTION_CONTROL_CLASS } from "@/windowCaptionControls.js";

/** Header 直接铺开的运行中会话图标数上限，其余收进 +N 折叠菜单。 */
export const HEADER_RUNNING_TASKS_MAX_VISIBLE = 6;

type RunningTaskItem = WindowHostControllerTaskListItem & Partial<TaskListMetaWithActivity>;

/**
 * Header 运行指示条的成员判定：与侧栏转圈同一语义（sessions-index 实时 phase），
 * 离线远程 source 的冻结快照不计入——断连时 lastActivityAt 不再推进，转圈会误导。
 */
export function selectHeaderRunningTasks(
  items: readonly WindowHostControllerTaskListItem[],
): RunningTaskItem[] {
  return items.filter(
    (item): item is RunningTaskItem =>
      item.sourceAvailability === "online" && isTaskListRowRunning(item),
  );
}

/** 会话等待权限/输入时 phase 仍是 running；用它切换 warning 色与 tooltip 等待标签。 */
export function isHeaderRunningTaskWaiting(item: RunningTaskItem): boolean {
  return getTaskListAttention(item) !== null;
}

export function splitHeaderRunningTasks(
  tasks: readonly RunningTaskItem[],
  maxVisible: number,
): { visible: RunningTaskItem[]; overflow: RunningTaskItem[] } {
  return {
    visible: tasks.slice(0, Math.max(0, maxVisible)),
    overflow: tasks.slice(Math.max(0, maxVisible)),
  };
}

export function WorkspaceRunningTaskIndicators({
  activeWorkspacePath,
  activeWorkspaceIdentity,
  activeTaskId,
  onSelectTask,
  useWindowsCaptionSpacing = false,
}: {
  activeWorkspacePath: string;
  activeWorkspaceIdentity?: string;
  activeTaskId?: string | null;
  onSelectTask: (
    workspacePath: string,
    taskId: string,
    workspaceIdentity?: string,
    remoteSessionId?: string,
  ) => void;
  useWindowsCaptionSpacing?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const tabs = useOptionalTabStore((state) => state.tabs);
  const workspaceTabs = useMemo(() => tabs.filter(isWorkspaceTab), [tabs]);
  const runningTaskList = useGlobalTaskList({
    kind: "active",
    workspaceTabs,
    sortBy: "updated",
    searchQuery: "",
    expanded: true,
    collapsedLimit: 1,
  });
  const runningTasks = useMemo(
    () => selectHeaderRunningTasks(runningTaskList.items),
    [runningTaskList.items],
  );
  const workspaceLabelByKey = useMemo(
    () =>
      new Map(
        workspaceTabs.map((tab) => [
          buildTaskWorkspaceKey(tab.workspacePath, tab.workspaceIdentity),
          tab.label,
        ]),
      ),
    [workspaceTabs],
  );
  const activeWorkspaceKey = buildTaskWorkspaceKey(activeWorkspacePath, activeWorkspaceIdentity);

  if (runningTasks.length === 0) {
    return null;
  }

  const { visible, overflow } = splitHeaderRunningTasks(
    runningTasks,
    HEADER_RUNNING_TASKS_MAX_VISIBLE,
  );

  const renderTooltipContent = (task: RunningTaskItem) => {
    const taskTitle =
      task.title ||
      intl.formatMessage({
        id: task.forkedFromTaskId ? "taskList.forkedUntitled" : "taskList.untitled",
      });
    const workspaceKey = buildTaskWorkspaceKey(task.workspacePath, task.workspaceIdentity);
    const workspaceLabel =
      workspaceKey !== activeWorkspaceKey ? workspaceLabelByKey.get(workspaceKey) : undefined;
    const attention = getTaskListAttention(task);
    const attentionLabel = attention
      ? intl.formatMessage({
          id: attention.kind === "userInput" ? "taskList.userInputTag" : "taskList.permissionTag",
        })
      : null;
    return (
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="min-w-0 truncate">{taskTitle}</span>
        {workspaceLabel ? (
          <span className="flex min-w-0 items-center gap-1 text-foreground-subtle">
            {task.workspaceIdentity?.trim() ? (
              <Cloud aria-hidden="true" className="size-3 shrink-0" />
            ) : null}
            <span className="min-w-0 truncate">{workspaceLabel}</span>
          </span>
        ) : null}
        {attentionLabel ? <span className="text-warning">{attentionLabel}</span> : null}
      </span>
    );
  };

  const renderSpinner = (task: RunningTaskItem, className?: string) => (
    <LoaderIcon
      aria-hidden="true"
      className={cn(
        className,
        "animate-spin",
        isHeaderRunningTaskWaiting(task) ? "text-warning" : "text-foreground-subtle",
      )}
    />
  );

  return (
    <div
      data-testid={TID_HEADER_RUNNING_TASKS}
      className="flex shrink-0 items-center gap-0.5 [app-region:no-drag]"
    >
      {visible.map((task) => {
        const entityKey = buildTaskEntityKey(task);
        const isActive =
          buildTaskWorkspaceKey(task.workspacePath, task.workspaceIdentity) ===
            activeWorkspaceKey && task.taskId === activeTaskId;
        return (
          <ControlHintTooltip key={entityKey} side="bottom" title={renderTooltipContent(task)}>
            <Button
              type="button"
              variant="ghost"
              size="icon-md"
              data-testid={testId(TID_HEADER_RUNNING_TASK, entityKey)}
              aria-label={task.title || intl.formatMessage({ id: "taskList.untitled" })}
              className={cn(
                "text-foreground hover:bg-hover hover:text-foreground [app-region:no-drag]",
                useWindowsCaptionSpacing && WINDOWS_CAPTION_CONTROL_CLASS,
                isActive && "!bg-selected",
              )}
              onClick={() =>
                onSelectTask(
                  task.workspacePath,
                  task.taskId,
                  task.workspaceIdentity,
                  task.remoteSessionId,
                )
              }
            >
              {renderSpinner(task, "size-4")}
            </Button>
          </ControlHintTooltip>
        );
      })}
      {overflow.length > 0 ? (
        <DropdownMenu>
          <ControlHintTooltip
            side="bottom"
            title={intl.formatMessage(
              { id: "appHeader.moreRunningTasks" },
              { count: String(overflow.length) },
            )}
          >
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-md"
                data-testid={TID_HEADER_RUNNING_TASKS_OVERFLOW}
                aria-label={intl.formatMessage(
                  { id: "appHeader.moreRunningTasks" },
                  { count: String(overflow.length) },
                )}
                className={cn(
                  "text-foreground hover:bg-hover hover:text-foreground [app-region:no-drag]",
                  useWindowsCaptionSpacing && WINDOWS_CAPTION_CONTROL_CLASS,
                )}
              >
                <span className="text-ui-xs font-medium">+{overflow.length}</span>
              </Button>
            </DropdownMenuTrigger>
          </ControlHintTooltip>
          <DropdownMenuContent align="end" className="w-64">
            {overflow.map((task) => {
              const entityKey = buildTaskEntityKey(task);
              const workspaceKey = buildTaskWorkspaceKey(
                task.workspacePath,
                task.workspaceIdentity,
              );
              const workspaceLabel =
                workspaceKey !== activeWorkspaceKey
                  ? workspaceLabelByKey.get(workspaceKey)
                  : undefined;
              return (
                <DropdownMenuItem
                  key={entityKey}
                  data-testid={testId(TID_HEADER_RUNNING_TASK, entityKey)}
                  onSelect={() =>
                    onSelectTask(
                      task.workspacePath,
                      task.taskId,
                      task.workspaceIdentity,
                      task.remoteSessionId,
                    )
                  }
                >
                  {renderSpinner(task, "size-3.5 shrink-0")}
                  <span className="min-w-0 flex-1 truncate">
                    {task.title || intl.formatMessage({ id: "taskList.untitled" })}
                  </span>
                  {workspaceLabel ? (
                    <span className="ml-auto flex min-w-0 max-w-24 shrink-0 items-center gap-1 truncate text-ui-xs text-foreground-subtle">
                      {task.workspaceIdentity?.trim() ? (
                        <Cloud aria-hidden="true" className="size-3 shrink-0" />
                      ) : null}
                      <span className="truncate">{workspaceLabel}</span>
                    </span>
                  ) : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {/* 与右侧功能图标组之间留一条细分隔，提示这一排是会话指示而非面板开关。 */}
      <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border/70" />
    </div>
  );
}
