import { describe, expect, it } from "vitest";
import type { SessionSummary } from "@zcode/shared/zcode-protocol-v4";
import {
  countActiveSessionSummaries,
  isActiveSessionSummary,
} from "../src/zcode-agent/runningSessionCount.js";

function summary(overrides: Partial<SessionSummary> & { sessionId: string }): SessionSummary {
  return {
    workspaceId: "ws",
    title: "t",
    phase: "completedSuccess",
    sessionEnded: true,
    hasBackgroundWork: false,
    lastActivityAt: 0,
    createdAt: 0,
    ...overrides,
  };
}

describe("runningSessionCount", () => {
  it("phase 在途（running/prewarming）计入活跃", () => {
    expect(isActiveSessionSummary(summary({ sessionId: "a", phase: "running" }))).toBe(true);
    expect(isActiveSessionSummary(summary({ sessionId: "a", phase: "prewarming" }))).toBe(true);
  });

  it("draft 与终态 phase 不计入", () => {
    for (const phase of ["draft", "completedSuccess", "completedInterrupted", "error"] as const) {
      expect(isActiveSessionSummary(summary({ sessionId: "a", phase }))).toBe(false);
    }
  });

  it("终态但有后台工作（父轮收口、subagent 在跑）仍计入", () => {
    expect(
      isActiveSessionSummary(
        summary({ sessionId: "a", phase: "completedSuccess", hasBackgroundWork: true }),
      ),
    ).toBe(true);
  });

  it("父会话在基线中时子会话不重复计数；孤儿会话兜底计入", () => {
    const parent = summary({
      sessionId: "parent",
      phase: "completedSuccess",
      hasBackgroundWork: true,
    });
    const child = summary({ sessionId: "child", phase: "running", parentSessionId: "parent" });
    const orphan = summary({ sessionId: "orphan", phase: "running", parentSessionId: "gone" });
    const summaries = new Map([
      [parent.sessionId, parent],
      [child.sessionId, child],
      [orphan.sessionId, orphan],
    ]);
    // parent(1) + orphan(1)，child 被父的 hasBackgroundWork 覆盖
    expect(countActiveSessionSummaries(summaries, true)).toBe(2);
  });

  it("runtime 未 attach 时一律返回 0（陈旧基线不拦截退出）", () => {
    const summaries = new Map([["a", summary({ sessionId: "a", phase: "running" })]]);
    expect(countActiveSessionSummaries(summaries, false)).toBe(0);
  });

  it("普通在途会话计数", () => {
    const summaries = new Map([
      ["a", summary({ sessionId: "a", phase: "running" })],
      ["b", summary({ sessionId: "b", phase: "draft" })],
      ["c", summary({ sessionId: "c", phase: "completedSuccess" })],
      ["d", summary({ sessionId: "d", phase: "error" })],
    ]);
    expect(countActiveSessionSummaries(summaries, true)).toBe(1);
  });
});
