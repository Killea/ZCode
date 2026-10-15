import { expect, it } from "vitest";
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

it("有活跃会话 + 用户取消 → 拦截关闭且不退出", () => {
  const { options, calls } = baseOptions({
    shouldConfirmQuit: true,
    confirmQuit: () => {
      return false;
    },
  });
  const handled = handleDesktopWindowCloseRequest(options);
  expect(handled).toBe(true);
  expect(calls.requestQuit).toBe(0);
  expect(calls.hideWindow).toBe(0);
});

it("有活跃会话 + 用户确认 → 正常退出", () => {
  let confirmCalled = 0;
  const { options, calls } = baseOptions({
    shouldConfirmQuit: true,
    confirmQuit: () => {
      confirmCalled += 1;
      return true;
    },
  });
  const handled = handleDesktopWindowCloseRequest(options);
  expect(handled).toBe(true);
  expect(confirmCalled).toBe(1);
  expect(calls.requestQuit).toBe(1);
});

it("无活跃会话 → 跳过确认直接退出", () => {
  let confirmCalled = 0;
  const { options, calls } = baseOptions({
    shouldConfirmQuit: false,
    confirmQuit: () => {
      confirmCalled += 1;
      return true;
    },
  });
  const handled = handleDesktopWindowCloseRequest(options);
  expect(handled).toBe(true);
  expect(confirmCalled).toBe(0);
  expect(calls.requestQuit).toBe(1);
});

it("forceQuit（更新安装等）→ 不拦截、不确认", () => {
  const { options, calls } = baseOptions({ forceQuit: true, shouldConfirmQuit: true });
  const handled = handleDesktopWindowCloseRequest(options);
  expect(handled).toBe(false);
  expect(calls.confirmQuit).toBe(0);
  expect(calls.requestQuit).toBe(0);
});

it("非最后窗口 → 不拦截", () => {
  const { options, calls } = baseOptions({ isLastWindow: false, shouldConfirmQuit: true });
  const handled = handleDesktopWindowCloseRequest(options);
  expect(handled).toBe(false);
  expect(calls.requestQuit).toBe(0);
});

it("Windows close-to-tray → 隐藏窗口不退出", () => {
  const { options, calls } = baseOptions({
    platform: "win32",
    closeToTray: true,
    closeToTraySupported: true,
    shouldConfirmQuit: true,
  });
  const handled = handleDesktopWindowCloseRequest(options);
  expect(handled).toBe(true);
  expect(calls.hideWindow).toBe(1);
  expect(calls.requestQuit).toBe(0);
});

it("Windows close-to-tray + 显式退出请求 → 不走托盘", () => {
  const { options, calls } = baseOptions({
    platform: "win32",
    closeToTray: true,
    closeToTraySupported: true,
    explicitQuitRequested: true,
    shouldConfirmQuit: true,
    confirmQuit: () => false,
  });
  const handled = handleDesktopWindowCloseRequest(options);
  expect(handled).toBe(true);
  expect(calls.hideWindow).toBe(0);
  expect(calls.requestQuit).toBe(0);
});

it("确认门控：打包 + 有活跃会话 → 确认", () => {
  expect(resolveShouldConfirmAppQuit({ isPackaged: true, runningSessionCount: 1 })).toBe(true);
});

it("确认门控：打包 + 无活跃会话 → 直接退出", () => {
  expect(resolveShouldConfirmAppQuit({ isPackaged: true, runningSessionCount: 0 })).toBe(false);
});

it("确认门控：test 后端的打包 Preview 也拦截", () => {
  // isPackaged 与后端环境无关：连 test 后端的安装包同样保护运行中会话。
  expect(
    resolveShouldConfirmAppQuit({
      isPackaged: true,
      runningSessionCount: 2,
    }),
  ).toBe(true);
});

it("确认门控：未打包 dev 运行不拦截", () => {
  expect(resolveShouldConfirmAppQuit({ isPackaged: false, runningSessionCount: 3 })).toBe(false);
});

it("确认门控：E2E 运行不拦截", () => {
  expect(
    resolveShouldConfirmAppQuit({
      isPackaged: true,
      e2eRunId: "e2e-run-1",
      runningSessionCount: 3,
    }),
  ).toBe(false);
});
