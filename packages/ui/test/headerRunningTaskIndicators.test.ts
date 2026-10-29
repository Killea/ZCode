import { describe, expect, it } from "vitest";
import type { WindowHostControllerTaskListItem } from "@zcode/services";
import type { TaskListRowActivity } from "@/v4/taskListRowActivity.js";
import { attachTaskListRowActivity } from "@/v4/taskListRowActivity.js";
import {
  HEADER_RUNNING_TASKS_MAX_VISIBLE,
  isHeaderRunningTaskWaiting,
  selectHeaderRunningTasks,
  splitHeaderRunningTasks,
} from "@/WorkspaceRunningTaskIndicators.js";

function headerTaskItem(params: {
  taskId: string;
  workspacePath?: string;
  workspaceIdentity?: string;
  sourceAvailability?: "online" | "offline";
  activity?: TaskListRowActivity | null;
}): WindowHostControllerTaskListItem {
  const item: WindowHostControllerTaskListItem = {
    taskId: params.taskId,
    traceId: `trace-${params.taskId}`,
    title: params.taskId,
    workspacePath: params.workspacePath ?? "/work/demo",
    ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
    createdAt: 1,
    updatedAt: 1,
    mode: "default",
    sourceAvailability: params.sourceAvailability ?? "online",
    liveStatus: "idle",
  };
  return params.activity ? attachTaskListRowActivity(item, params.activity) : item;
}

function runningActivity(overrides: Partial<TaskListRowActivity> = {}): TaskListRowActivity {
  return {
    phase: "running",
    lastActivityAt: 1000,
    hasBackgroundWork: false,
    ...overrides,
  };
}

describe("selectHeaderRunningTasks", () => {
  it("只保留 online 且 sessions-index phase 为 prewarming/running 的会话", () => {
    const items = [
      headerTaskItem({ taskId: "running", activity: runningActivity() }),
      headerTaskItem({ taskId: "prewarming", activity: runningActivity({ phase: "prewarming" }) }),
      headerTaskItem({ taskId: "idle", activity: runningActivity({ phase: "completedSuccess" }) }),
      headerTaskItem({ taskId: "persisted-running-no-activity" }),
      headerTaskItem({
        taskId: "offline-running",
        sourceAvailability: "offline",
        activity: runningActivity(),
      }),
    ];

    expect(selectHeaderRunningTasks(items).map((item) => item.taskId)).toEqual([
      "running",
      "prewarming",
    ]);
  });

  it("输入为空或非数组元素缺 activity 时返回空集", () => {
    expect(selectHeaderRunningTasks([])).toEqual([]);
  });
});

describe("isHeaderRunningTaskWaiting", () => {
  it("pendingInteractions 计数大于 0 视为等待输入", () => {
    const waiting = headerTaskItem({
      taskId: "waiting",
      activity: runningActivity({
        pendingInteractions: { permissionCount: 1, userInputCount: 0 },
      }),
    });
    const running = headerTaskItem({ taskId: "running", activity: runningActivity() });

    expect(isHeaderRunningTaskWaiting(waiting)).toBe(true);
    expect(isHeaderRunningTaskWaiting(running)).toBe(false);
  });
});

describe("splitHeaderRunningTasks", () => {
  it("前 maxVisible 个铺开，其余进入 overflow", () => {
    const tasks = Array.from({ length: HEADER_RUNNING_TASKS_MAX_VISIBLE + 2 }, (_, index) =>
      headerTaskItem({ taskId: `task-${index}`, activity: runningActivity() }),
    );
    const { visible, overflow } = splitHeaderRunningTasks(tasks, HEADER_RUNNING_TASKS_MAX_VISIBLE);
    expect(visible).toHaveLength(HEADER_RUNNING_TASKS_MAX_VISIBLE);
    expect(overflow.map((item) => item.taskId)).toEqual([
      `task-${HEADER_RUNNING_TASKS_MAX_VISIBLE}`,
      `task-${HEADER_RUNNING_TASKS_MAX_VISIBLE + 1}`,
    ]);
  });
});
