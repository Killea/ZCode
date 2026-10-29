import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import type {
  IServiceAccessor,
  IWindowControllerService,
  WindowHostControllerTaskListItem,
} from "@zcode/services";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { ServiceProvider } from "@/hooks/useServices.js";
import { TabStoreProvider, useTabStoreApi } from "@/store/TabStoreProvider.js";
import { WorkspaceRunningTaskIndicators } from "@/WorkspaceRunningTaskIndicators.js";
import "@/styles.css";

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") !== "light");

const WS_A = "/ws-a";
const WS_B = "/ws-b";
const WS_B_IDENTITY = "ssh://devbox/ws-b";
const WS_B_REMOTE_SESSION = "remote-session-1";

/**
 * 场景由 ?scenario= 控制：
 * - 默认：8 个在线 running（ws-a 5 个：t1 当前激活、t2 等待权限→warning 色；
 *   ws-b 远程 3 个）+ 最近会话若干 + 1 个 offline running。
 *   期望直显 6 个转圈 + "+2" 折叠，最近会话与 offline 不出现。
 * - backfill：2 个 running + 多个最近会话（含 unread 蓝点、error 红点、普通灰点）
 *   + 1 个 offline。期望 2 个转圈 + 4 个静态点补满 6 槽，无折叠按钮。
 * - sparse：0 个 running + 3 个最近会话。期望 3 个静态点，无折叠按钮。
 */
function task(partial: {
  taskId: string;
  title: string;
  workspacePath?: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  phase?: "prewarming" | "running" | "completedSuccess";
  waiting?: boolean;
  offline?: boolean;
  unread?: boolean;
  errorStatus?: boolean;
  noActivity?: boolean;
}): WindowHostControllerTaskListItem {
  return {
    taskId: partial.taskId,
    traceId: `trace-${partial.taskId}`,
    title: partial.title,
    workspacePath: partial.workspacePath ?? WS_A,
    ...(partial.workspaceIdentity ? { workspaceIdentity: partial.workspaceIdentity } : {}),
    ...(partial.remoteSessionId ? { remoteSessionId: partial.remoteSessionId } : {}),
    createdAt: 1,
    updatedAt: 1,
    mode: "default",
    status: partial.errorStatus ? "error" : "running",
    ...(partial.unread ? { unreadAt: 5 } : {}),
    sourceAvailability: partial.offline ? "offline" : "online",
    liveStatus: partial.waiting ? "waiting" : "running",
    ...(partial.noActivity
      ? {}
      : {
          activity: {
            phase: partial.phase ?? "running",
            lastActivityAt: 1,
            hasBackgroundWork: false,
            ...(partial.waiting
              ? { pendingInteractions: { permissionCount: 1, userInputCount: 0 } }
              : {}),
          },
        }),
  } as WindowHostControllerTaskListItem;
}

const remoteRunning = (taskId: string, title: string) =>
  task({
    taskId,
    title,
    workspacePath: WS_B,
    workspaceIdentity: WS_B_IDENTITY,
    remoteSessionId: WS_B_REMOTE_SESSION,
  });

const recentItems = [
  task({ taskId: "done", title: "Finished task", phase: "completedSuccess" }),
  task({
    taskId: "unread",
    title: "Unread update",
    phase: "completedSuccess",
    unread: true,
  }),
  task({ taskId: "failed", title: "Failed import", errorStatus: true, noActivity: true }),
  task({
    taskId: "old-remote",
    title: "Old remote run",
    workspacePath: WS_B,
    workspaceIdentity: WS_B_IDENTITY,
    remoteSessionId: WS_B_REMOTE_SESSION,
    phase: "completedSuccess",
  }),
  task({ taskId: "archived-feeling", title: "Stale draft", phase: "completedSuccess" }),
];

const scenario = params.get("scenario");
const items: WindowHostControllerTaskListItem[] =
  scenario === "backfill"
    ? [
        task({ taskId: "t1", title: "Fix login crash" }),
        task({ taskId: "t2", title: "Migrate database", waiting: true }),
        ...recentItems,
        task({
          taskId: "gone",
          title: "Offline running",
          workspacePath: WS_B,
          workspaceIdentity: WS_B_IDENTITY,
          offline: true,
        }),
      ]
    : scenario === "sparse"
      ? recentItems.slice(0, 3)
      : [
          task({ taskId: "t1", title: "Fix login crash" }),
          task({ taskId: "t2", title: "Migrate database", waiting: true }),
          task({ taskId: "t3", title: "Add dark mode" }),
          task({ taskId: "t4", title: "Refactor auth" }),
          task({ taskId: "t5", title: "Bump deps" }),
          remoteRunning("t6", "Remote build"),
          remoteRunning("t7", "Remote lint"),
          remoteRunning("t8", "Remote deploy"),
          ...recentItems,
          task({
            taskId: "gone",
            title: "Offline running",
            workspacePath: WS_B,
            workspaceIdentity: WS_B_IDENTITY,
            offline: true,
          }),
        ];

const subscribeAck = { subscriptionId: "fixture-sub", mode: "snapshot", logEpoch: "fx" } as const;
const windowControllerService = {
  listTaskList: async () => ({ items, total: items.length, hasMore: false }),
  subscribeControllerV4: async () => ({ ack: { ...subscribeAck } }),
  resyncControllerV4: async () => ({ ack: { ...subscribeAck } }),
  unsubscribeControllerV4: async () => {},
  mutateTask: async () => null,
  deleteArchivedTask: async () => false,
  deleteArchivedTasks: async () => ({ deletedTaskIds: [] }),
  onDynamicControllerFrame: () => (_listener: unknown) => ({ dispose() {} }),
} as unknown as IWindowControllerService;

const services = { windowControllerService } as unknown as IServiceAccessor;

declare global {
  interface Window {
    __headerRunningSelections?: unknown[][];
  }
}
window.__headerRunningSelections = [];

function TabSeed() {
  const store = useTabStoreApi();
  useEffect(() => {
    store
      .getState()
      .restoreTabs([WS_A, { workspacePath: WS_B, workspaceIdentity: WS_B_IDENTITY }], 0);
  }, [store]);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <ServiceProvider services={services}>
    <ZCodeIntlProvider initialLocale={params.get("locale") === "zh-CN" ? "zh-CN" : "en-US"}>
      <TooltipProvider>
        <TabStoreProvider>
          <TabSeed />
          <main className="flex min-h-screen items-start justify-end bg-background p-2">
            <WorkspaceRunningTaskIndicators
              activeWorkspacePath={WS_A}
              activeTaskId="t1"
              onSelectTask={(workspacePath, taskId, workspaceIdentity, remoteSessionId) => {
                window.__headerRunningSelections?.push([
                  workspacePath,
                  taskId,
                  workspaceIdentity ?? null,
                  remoteSessionId ?? null,
                ]);
              }}
            />
            <button type="button" data-testid="header-right-icon" className="size-8">
              ⚙
            </button>
          </main>
        </TabStoreProvider>
      </TooltipProvider>
    </ZCodeIntlProvider>
  </ServiceProvider>,
);
