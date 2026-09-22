interface WorkspaceShellWindowChromeOptions {
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
  isLinuxDesktop?: boolean;
  macOSMajorVersion?: number | null;
  isWindowsMaximized: boolean;
  supportsNativeRoundedCorners: boolean | null;
}

type WorkspaceShellPlatformRadiusOptions = Pick<
  WorkspaceShellWindowChromeOptions,
  "isMacDesktop" | "isWindowsDesktop" | "isLinuxDesktop" | "macOSMajorVersion"
>;

// 界面直角化（DESIGN.md「Radius」）：面板圆角全平台归 0，平台参数仅为兼容既有调用面保留。
export function resolveWorkspaceShellPanelRadiusPx(
  _options: WorkspaceShellPlatformRadiusOptions,
): number {
  return 0;
}

export function resolveWorkspaceShellResizeHandleInsetPx(
  options: WorkspaceShellPlatformRadiusOptions,
): number {
  return resolveWorkspaceShellPanelRadiusPx(options) + 4;
}

export function resolveWorkspaceShellWindowChromeClass(
  _options: WorkspaceShellWindowChromeOptions,
): string {
  return "rounded-none border border-border";
}
