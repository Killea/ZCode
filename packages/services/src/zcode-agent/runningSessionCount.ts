import type { SessionSummary } from "@zcode/shared/zcode-protocol-v4";

/**
 * 活跃会话计数投影（docs/app-quit-confirmation.md）。
 * 独立成模块：纯函数、无 I/O，desktop 退出确认与测试共用同一口径。
 */

/** 轮次在途，或父轮已收口但 subagent/后台工作仍在跑。 */
export function isActiveSessionSummary(summary: SessionSummary): boolean {
  return (
    summary.phase === "prewarming" ||
    summary.phase === "running" ||
    summary.hasBackgroundWork === true
  );
}

export function countActiveSessionSummaries(
  summaries: ReadonlyMap<string, SessionSummary>,
  runtimeAttached: boolean,
): number {
  // runtime 未 attach/已死亡时，基线里的 running 摘要只是陈旧数据，
  // 不能据此永久拦截退出；reattach 后由真实帧重新计数。
  if (!runtimeAttached) {
    return 0;
  }
  let count = 0;
  for (const summary of summaries.values()) {
    if (!isActiveSessionSummary(summary)) {
      continue;
    }
    // 父会话仍在基线中时，子会话不重复计数（父经 hasBackgroundWork 已覆盖）；
    // 父已不在基线中的孤儿子会话按顶层会话兜底计入。
    if (summary.parentSessionId !== undefined && summaries.has(summary.parentSessionId)) {
      continue;
    }
    count += 1;
  }
  return count;
}
