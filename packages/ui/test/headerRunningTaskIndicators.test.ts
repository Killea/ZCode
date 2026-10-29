import { describe, expect, it } from "vitest";
import type { WindowHostControllerTaskListItem } from "@zcode/services";
import type { TaskListRowActivity } from "@/v4/taskListRowActivity.js";
import { attachTaskListRowActivity } from "@/v4/taskListRowActivity.js";
import {
  HEADER_RUNNING_TASKS_MAX_VISIBLE,
  isHeaderRunningTaskWaiting,
  selectHeaderIndicatorTasks,
} from "@/WorkspaceRunningTaskIndicators.js";

const MAX = HEADER_RUNNING_TASKS_MAX_VISIBLE;

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

function idleActivity(overrides: Partial<TaskListRowActivity> = {}): TaskListRowActivity {
  return {
    phase: "completedSuccess",
    lastActivityAt: 1000,
    hasBackgroundWork: false,
    ...overrides,
  };
}

describe("selectHeaderIndicatorTasks", () => {
  it("running 优先占槽，prewarming/running 都算，持久化 status 不算", () => {
    const items = [
      headerTaskItem({ taskId: "idle", activity: idleActivity() }),
      headerTaskItem({ taskId: "running", activity: runningActivity() }),
      headerTaskItem({ taskId: "prewarming", activity: runningActivity({ phase: "prewarming" }) }),
      headerTaskItem({ taskId: "persisted-running-no-activity" }),
    ];

    const { visible, overflow } = selectHeaderIndicatorTasks(items, MAX);
    expect(visible.map((item) => item.taskId)).toEqual([
      "running",
      "prewarming",
      "idle",
      "persisted-running-no-activity",
    ]);
    expect(overflow).toEqual([]);
  });

  it("running 不足时用最近会话补齐到 maxVisible，补齐项不参与 overflow", () => {
    const items = [
      headerTaskItem({ taskId: "run-1", activity: runningActivity() }),
      headerTaskItem({ taskId: "run-2", activity: runningActivity() }),
      ...Array.from({ length: MAX + 3 }, (_, index) =>
        headerTaskItem({ taskId: `recent-${index}`, activity: idleActivity() }),
      ),
    ];

    const { visible, overflow } = selectHeaderIndicatorTasks(items, MAX);
    expect(visible.map((item) => item.taskId)).toEqual([
      "run-1",
      "run-2",
      "recent-0",
      "recent-1",
      "recent-2",
      "recent-3",
    ]);
    expect(overflow).toEqual([]);
  });

  it("running 超过 maxVisible 时其余进 overflow，不再补齐", () => {
    const items = [
      ...Array.from({ length: MAX + 2 }, (_, index) =>
        headerTaskItem({ taskId: `run-${index}`, activity: runningActivity() }),
      ),
      headerTaskItem({ taskId: "recent", activity: idleActivity() }),
    ];

    const { visible, overflow } = selectHeaderIndicatorTasks(items, MAX);
    expect(visible).toHaveLength(MAX);
    expect(overflow.map((item) => item.taskId)).toEqual([`run-${MAX}`, `run-${MAX + 1}`]);
  });

  it("offline source 既不占运行槽也不参与补齐", () => {
    const items = [
      headerTaskItem({ taskId: "run", activity: runningActivity() }),
      headerTaskItem({
        taskId: "offline-running",
        sourceAvailability: "offline",
        activity: runningActivity(),
      }),
      headerTaskItem({
        taskId: "offline-idle",
        sourceAvailability: "offline",
        activity: idleActivity(),
      }),
      headerTaskItem({ taskId: "recent", activity: idleActivity() }),
    ];

    const { visible, overflow } = selectHeaderIndicatorTasks(items, MAX);
    expect(visible.map((item) => item.taskId)).toEqual(["run", "recent"]);
    expect(overflow).toEqual([]);
  });

  it("集合为空时返回空 visible，组件据此不渲染", () => {
    const { visible, overflow } = selectHeaderIndicatorTasks([], MAX);
    expect(visible).toEqual([]);
    expect(overflow).toEqual([]);
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
