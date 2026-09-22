import assert from "node:assert/strict";
import test from "node:test";
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

test("phase 在途（running/prewarming）计入活跃", () => {
  assert.equal(isActiveSessionSummary(summary({ sessionId: "a", phase: "running" })), true);
  assert.equal(isActiveSessionSummary(summary({ sessionId: "a", phase: "prewarming" })), true);
});

test("draft 与终态 phase 不计入", () => {
  for (const phase of ["draft", "completedSuccess", "completedInterrupted", "error"] as const) {
    assert.equal(isActiveSessionSummary(summary({ sessionId: "a", phase })), false);
  }
});

test("终态但有后台工作（父轮收口、subagent 在跑）仍计入", () => {
  assert.equal(
    isActiveSessionSummary(
      summary({ sessionId: "a", phase: "completedSuccess", hasBackgroundWork: true }),
    ),
    true,
  );
});

test("父会话在基线中时子会话不重复计数；孤儿会话兜底计入", () => {
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
  assert.equal(countActiveSessionSummaries(summaries, true), 2);
});

test("runtime 未 attach 时一律返回 0（陈旧基线不拦截退出）", () => {
  const summaries = new Map([["a", summary({ sessionId: "a", phase: "running" })]]);
  assert.equal(countActiveSessionSummaries(summaries, false), 0);
});

test("普通在途会话计数", () => {
  const summaries = new Map([
    ["a", summary({ sessionId: "a", phase: "running" })],
    ["b", summary({ sessionId: "b", phase: "draft" })],
    ["c", summary({ sessionId: "c", phase: "completedSuccess" })],
    ["d", summary({ sessionId: "d", phase: "error" })],
  ]);
  assert.equal(countActiveSessionSummaries(summaries, true), 1);
});
