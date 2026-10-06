import assert from "node:assert/strict";
import test from "node:test";
import {
  handleDesktopWindowCloseRequest,
  resolveShouldConfirmAppQuit,
} from "../src/main/desktopWindowCloseRequest.js";

const noopLogger = { info: () => {} };

function baseOptions(overrides: Partial<Parameters<typeof handleDesktopWindowCloseRequest>[0]>) {
  const calls = { confirmQuit: 0, requestQuit: 0, hideWindow: 0 };
  const options = {
    platform: "linux" as NodeJS.Platform,
    forceQuit: false,
    isLastWindow: true,
    label: "local-1",
    logger: noopLogger,
    confirmQuit: () => {
      calls.confirmQuit += 1;
      return true;
    },
    requestQuit: () => {
      calls.requestQuit += 1;
    },
    hideWindow: () => {
      calls.hideWindow += 1;
    },
    ...overrides,
  };
  return { options, calls };
}

test("有活跃会话 + 用户取消 → 拦截关闭且不退出", () => {
  const { options, calls } = baseOptions({
    shouldConfirmQuit: true,
    confirmQuit: () => {
      return false;
    },
  });
  const handled = handleDesktopWindowCloseRequest(options);
  assert.equal(handled, true);
  assert.equal(calls.requestQuit, 0);
  assert.equal(calls.hideWindow, 0);
});

test("有活跃会话 + 用户确认 → 正常退出", () => {
  let confirmCalled = 0;
  const { options, calls } = baseOptions({
    shouldConfirmQuit: true,
    confirmQuit: () => {
      confirmCalled += 1;
      return true;
    },
  });
  const handled = handleDesktopWindowCloseRequest(options);
  assert.equal(handled, true);
  assert.equal(confirmCalled, 1);
  assert.equal(calls.requestQuit, 1);
});

test("无活跃会话 → 跳过确认直接退出", () => {
  let confirmCalled = 0;
  const { options, calls } = baseOptions({
    shouldConfirmQuit: false,
    confirmQuit: () => {
      confirmCalled += 1;
      return true;
    },
  });
  const handled = handleDesktopWindowCloseRequest(options);
  assert.equal(handled, true);
  assert.equal(confirmCalled, 0);
  assert.equal(calls.requestQuit, 1);
});

test("forceQuit（更新安装等）→ 不拦截、不确认", () => {
  const { options, calls } = baseOptions({ forceQuit: true, shouldConfirmQuit: true });
  const handled = handleDesktopWindowCloseRequest(options);
  assert.equal(handled, false);
  assert.equal(calls.confirmQuit, 0);
  assert.equal(calls.requestQuit, 0);
});

test("非最后窗口 → 不拦截", () => {
  const { options, calls } = baseOptions({ isLastWindow: false, shouldConfirmQuit: true });
  const handled = handleDesktopWindowCloseRequest(options);
  assert.equal(handled, false);
  assert.equal(calls.requestQuit, 0);
});

test("Windows close-to-tray → 隐藏窗口不退出", () => {
  const { options, calls } = baseOptions({
    platform: "win32",
    closeToTrayOnWindows: true,
    shouldConfirmQuit: true,
  });
  const handled = handleDesktopWindowCloseRequest(options);
  assert.equal(handled, true);
  assert.equal(calls.hideWindow, 1);
  assert.equal(calls.requestQuit, 0);
});

test("Windows close-to-tray + 显式退出请求 → 不走托盘", () => {
  const { options, calls } = baseOptions({
    platform: "win32",
    closeToTrayOnWindows: true,
    explicitQuitRequested: true,
    shouldConfirmQuit: true,
    confirmQuit: () => false,
  });
  const handled = handleDesktopWindowCloseRequest(options);
  assert.equal(handled, true);
  assert.equal(calls.hideWindow, 0);
  assert.equal(calls.requestQuit, 0);
});

test("确认门控：打包 + 有活跃会话 → 确认", () => {
  assert.equal(resolveShouldConfirmAppQuit({ isPackaged: true, runningSessionCount: 1 }), true);
});

test("确认门控：打包 + 无活跃会话 → 直接退出", () => {
  assert.equal(resolveShouldConfirmAppQuit({ isPackaged: true, runningSessionCount: 0 }), false);
});

test("确认门控：test 后端的打包 Preview 也拦截", () => {
  // isPackaged 与后端环境无关：连 test 后端的安装包同样保护运行中会话。
  assert.equal(
    resolveShouldConfirmAppQuit({
      isPackaged: true,
      runningSessionCount: 2,
    }),
    true,
  );
});

test("确认门控：未打包 dev 运行不拦截", () => {
  assert.equal(resolveShouldConfirmAppQuit({ isPackaged: false, runningSessionCount: 3 }), false);
});

test("确认门控：E2E 运行不拦截", () => {
  assert.equal(
    resolveShouldConfirmAppQuit({
      isPackaged: true,
      e2eRunId: "e2e-run-1",
      runningSessionCount: 3,
    }),
    false,
  );
});
