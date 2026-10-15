import { describe, expect, it } from "vitest";
import {
  resolveWorkspaceShellPanelRadiusPx,
  resolveWorkspaceShellResizeHandleInsetPx,
  resolveWorkspaceShellWindowChromeClass,
} from "../src/app-shell/workspaceShellWindowChrome.js";

// 界面直角化（DESIGN.md「Radius」）：面板圆角全平台归 0，不再随平台/系统版本/
// Windows 原生圆角能力变化。上游旧版按 macOS Tahoe/Sequoia 与 Windows 10/11
// 分档取 12/6/5px 的断言在此全部替换为固定的直角期望；平台与能力参数仅保留
// 在调用面上以兼容既有调用方，行为上必须被忽略——下面每个平台/状态组合都
// 断言同一个直角输出，防止将来有人按平台重新分支。
describe("resolveWorkspaceShellWindowChromeClass（直角化）", () => {
  const SQUARE = "rounded-none border border-border";

  it("macOS Sequoia 及更早版本也是直角", () => {
    expect(
      resolveWorkspaceShellWindowChromeClass({
        isMacDesktop: true,
        macOSMajorVersion: 15,
        isWindowsDesktop: false,
        isWindowsMaximized: false,
        supportsNativeRoundedCorners: false,
      }),
    ).toBe(SQUARE);
  });

  it("macOS Tahoe 及以后版本也是直角", () => {
    expect(
      resolveWorkspaceShellWindowChromeClass({
        isMacDesktop: true,
        macOSMajorVersion: 26,
        isWindowsDesktop: false,
        isWindowsMaximized: false,
        supportsNativeRoundedCorners: false,
      }),
    ).toBe(SQUARE);
  });

  it("Windows 11 普通窗口是直角", () => {
    expect(
      resolveWorkspaceShellWindowChromeClass({
        isWindowsDesktop: true,
        isWindowsMaximized: false,
        supportsNativeRoundedCorners: true,
      }),
    ).toBe(SQUARE);
  });

  it("Windows 11 最大化仍保持完整边框（直角）", () => {
    expect(
      resolveWorkspaceShellWindowChromeClass({
        isWindowsDesktop: true,
        isWindowsMaximized: true,
        supportsNativeRoundedCorners: true,
      }),
    ).toBe(SQUARE);
  });

  it("Windows 10 不再单侧直角化，全平台统一", () => {
    expect(
      resolveWorkspaceShellWindowChromeClass({
        isWindowsDesktop: true,
        isWindowsMaximized: false,
        supportsNativeRoundedCorners: false,
      }),
    ).toBe(SQUARE);
    expect(
      resolveWorkspaceShellWindowChromeClass({
        isWindowsDesktop: true,
        isWindowsMaximized: true,
        supportsNativeRoundedCorners: false,
      }),
    ).toBe(SQUARE);
  });

  it("Windows 能力未知时同样不退回旧圆角", () => {
    expect(
      resolveWorkspaceShellWindowChromeClass({
        isWindowsDesktop: true,
        isWindowsMaximized: false,
        supportsNativeRoundedCorners: null,
      }),
    ).toBe(SQUARE);
  });

  it.each([false, true])(
    "Linux 最大化=%s 也是直角（不再沿用设置页 xl）",
    (isWindowsMaximized) => {
      expect(
        resolveWorkspaceShellWindowChromeClass({
          isLinuxDesktop: true,
          isWindowsDesktop: false,
          isWindowsMaximized,
          supportsNativeRoundedCorners: false,
        }),
      ).toBe(SQUARE);
    },
  );
});

describe("workspace shell 面板圆角与 resize handle inset（直角化）", () => {
  it.each([
    ["macOS Sequoia", { isMacDesktop: true, macOSMajorVersion: 15 }],
    ["unknown macOS", { isMacDesktop: true, macOSMajorVersion: null }],
    ["macOS Sonoma", { isMacDesktop: true, macOSMajorVersion: 14 }],
    ["macOS Tahoe", { isMacDesktop: true, macOSMajorVersion: 26 }],
    ["Web", {}],
    ["Windows", { isWindowsDesktop: true }],
    ["Linux", { isLinuxDesktop: true }],
  ] as const)("全平台 %s 圆角为 0、inset 固定 4", (_name, platform) => {
    expect(resolveWorkspaceShellPanelRadiusPx(platform)).toBe(0);
    expect(resolveWorkspaceShellResizeHandleInsetPx(platform)).toBe(4);
  });
});
