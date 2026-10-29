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
 * 8 个在线 running：ws-a 5 个（t1 为当前激活会话，t2 等待权限输入→warning 色），
 * ws-b 远程 3 个。再加 1 个 completedSuccess 与 1 个 offline running，
 * 期望直显 6 个图标 + "+2" 折叠，过滤行一律不出现。
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
    status: "running",
    sourceAvailability: partial.offline ? "offline" : "online",
    liveStatus: partial.waiting ? "waiting" : "running",
    activity: {
      phase: partial.phase ?? "running",
      lastActivityAt: 1,
      hasBackgroundWork: false,
      ...(partial.waiting
        ? { pendingInteractions: { permissionCount: 1, userInputCount: 0 } }
        : {}),
    },
  } as WindowHostControllerTaskListItem;
}

const items: WindowHostControllerTaskListItem[] = [
  task({ taskId: "t1", title: "Fix login crash" }),
  task({ taskId: "t2", title: "Migrate database", waiting: true }),
  task({ taskId: "t3", title: "Add dark mode" }),
  task({ taskId: "t4", title: "Refactor auth" }),
  task({ taskId: "t5", title: "Bump deps" }),
  task({
    taskId: "t6",
    title: "Remote build",
    workspacePath: WS_B,
    workspaceIdentity: WS_B_IDENTITY,
    remoteSessionId: WS_B_REMOTE_SESSION,
  }),
  task({
    taskId: "t7",
    title: "Remote lint",
    workspacePath: WS_B,
    workspaceIdentity: WS_B_IDENTITY,
    remoteSessionId: WS_B_REMOTE_SESSION,
  }),
  task({
    taskId: "t8",
    title: "Remote deploy",
    workspacePath: WS_B,
    workspaceIdentity: WS_B_IDENTITY,
    remoteSessionId: WS_B_REMOTE_SESSION,
  }),
  task({ taskId: "done", title: "Finished task", phase: "completedSuccess" }),
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
