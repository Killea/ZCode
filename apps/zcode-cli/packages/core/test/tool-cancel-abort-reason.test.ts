import assert from "node:assert/strict";
import test from "node:test";
import type { ToolEntry, ToolExecutionContext } from "../src/tool/types.js";
import {
  executeWithTimeout,
  ToolDeadline,
} from "../src/tool/executor/timeout.js";

// 工具因父级 abort 取消时，之前只输出 entry.cancellation.userVisibleMessage，
// abortSignal.reason（如 host 断连的 "Protocol runtime stopping"）被丢弃，
// 用户无法区分"手动停止"与"运行时关闭"。这些测试锁住把 reason 附加到
// 取消消息的契约（docs/tool-cancel-abort-reason.md）。

const ENTRY = {
  metadata: { name: "mcp__playwright__browser_run_code_unsafe" },
  cancellation: { userVisibleMessage: "MCP tool was cancelled", cleanup: "bestEffort" },
} as unknown as ToolEntry;

function contextWith(signal: AbortSignal): ToolExecutionContext {
  return { abortSignal: signal } as ToolExecutionContext;
}

function pendingHandler() {
  return () => new Promise<never>(() => {});
}

test("abort reason 为 Error 时附加到取消消息", async () => {
  const controller = new AbortController();
  const promise = executeWithTimeout(
    pendingHandler(),
    {},
    contextWith(controller.signal),
    new ToolDeadline(60_000),
    new AbortController(),
    ENTRY,
  );
  controller.abort(new Error("Protocol runtime stopping"));
  await assert.rejects(promise, (error: Error) => {
    assert.equal(error.message, "MCP tool was cancelled — Protocol runtime stopping");
    return true;
  });
});

test("裸 abort（AbortError）保持原消息不附加", async () => {
  const controller = new AbortController();
  const promise = executeWithTimeout(
    pendingHandler(),
    {},
    contextWith(controller.signal),
    new ToolDeadline(60_000),
    new AbortController(),
    ENTRY,
  );
  controller.abort();
  await assert.rejects(promise, (error: Error) => {
    assert.equal(error.message, "MCP tool was cancelled");
    return true;
  });
});

test("字符串 reason 同样附加", async () => {
  const controller = new AbortController();
  const promise = executeWithTimeout(
    pendingHandler(),
    {},
    contextWith(controller.signal),
    new ToolDeadline(60_000),
    new AbortController(),
    ENTRY,
  );
  controller.abort("user pressed stop");
  await assert.rejects(promise, (error: Error) => {
    assert.equal(error.message, "MCP tool was cancelled — user pressed stop");
    return true;
  });
});

test("进入时 signal 已 aborted 也带 reason", async () => {
  const controller = new AbortController();
  controller.abort(new Error("foreground execution stopped"));
  await assert.rejects(
    executeWithTimeout(
      pendingHandler(),
      {},
      contextWith(controller.signal),
      new ToolDeadline(60_000),
      new AbortController(),
      ENTRY,
    ),
    (error: Error) => {
      assert.equal(error.message, "MCP tool was cancelled — foreground execution stopped");
      return true;
    },
  );
});

test("超时路径不受影响，仍为 ToolTimeout", async () => {
  await assert.rejects(
    executeWithTimeout(
      pendingHandler(),
      {},
      contextWith(new AbortController().signal),
      new ToolDeadline(5),
      new AbortController(),
      ENTRY,
    ),
    (error: Error & { code?: string }) => {
      assert.match(error.message, /timed out/);
      return true;
    },
  );
});

test("正常完成不受干扰", async () => {
  const result = await executeWithTimeout(
    () => Promise.resolve("ok"),
    {},
    contextWith(new AbortController().signal),
    new ToolDeadline(60_000),
    new AbortController(),
    ENTRY,
  );
  assert.equal(result, "ok");
});
