import assert from "node:assert/strict";
import test from "node:test";
import { createHostUncaughtExceptionHandler } from "../src/host/hostUncaughtExceptionGuard.js";

function collect() {
  const recovered: Error[] = [];
  const fatal: Error[] = [];
  const handler = createHostUncaughtExceptionHandler({
    onRecovered: (error) => recovered.push(error),
    onFatal: (error) => fatal.push(error),
  });
  return { handler, recovered, fatal };
}

// 2026-09-21 事故回归：host 的 stdout 旁路日志管道读端关闭后，writeHostLog 的
// console.log 同步抛 write EPIPE，未兜住升级成 uncaughtException → exit(1)，
// 窗口内全部在途 session 冻结。EPIPE 必须归类为可恢复，不能杀进程。
test("EPIPE is recovered, not fatal", () => {
  const { handler, recovered, fatal } = collect();
  const epipe = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
  handler(epipe, "uncaughtException");
  assert.equal(recovered.length, 1);
  assert.equal(fatal.length, 0);
});

test("native TLS allocation failure stays recovered", () => {
  const { handler, recovered, fatal } = collect();
  handler(new RangeError("Failed to allocate memory"), "uncaughtException");
  assert.equal(recovered.length, 1);
  assert.equal(fatal.length, 0);
});

test("unrelated errors stay fatal", () => {
  const { handler, recovered, fatal } = collect();
  handler(new Error("boom"), "uncaughtException");
  handler(Object.assign(new Error("closed"), { code: "ECONNRESET" }), "uncaughtException");
  assert.equal(recovered.length, 0);
  assert.equal(fatal.length, 2);
});

test("onRecovered throwing does not escape the handler", () => {
  const handler = createHostUncaughtExceptionHandler({
    onRecovered: () => {
      throw new Error("log failed");
    },
    onFatal: () => {},
  });
  const epipe = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
  assert.doesNotThrow(() => handler(epipe, "uncaughtException"));
});
