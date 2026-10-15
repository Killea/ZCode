/**
 * 主窗口关闭请求裁决（docs/app-quit-confirmation.md）。
 * 独立成文件而非留在 desktopWindowLifecycle：纯函数依赖注入，单测不需要拉起 Electron。
 */
export function resolveShouldConfirmAppQuit(options: {
  /** app.isPackaged：打包安装形态（含连 test 后端的 Preview/本地 linux-unpacked）。 */
  isPackaged: boolean;
  /** E2E 运行标记（process.env.ZCODE_E2E_RUN_ID）；自动化退出不得被同步确认框卡住。 */
  e2eRunId?: string;
  runningSessionCount: number;
}): boolean {
  // 之前按 ZCODE_ENV === "production" 门控，把 test 后端的打包 Preview 一并排除，
  // 导致本地 linux-unpacked 验证时确认框永远不弹。dev/E2E 都是未打包的 electron
  // 运行（app.isPackaged=false），isPackaged 已覆盖原"不打断调试"的意图。
  return options.isPackaged && !options.e2eRunId?.trim() && options.runningSessionCount > 0;
}

export function handleDesktopWindowCloseRequest(options: {
  platform: NodeJS.Platform;
  forceQuit: boolean;
  explicitQuitRequested?: boolean;
  closeToTray?: boolean;
  /**
   * 关闭驻留的托盘能力（spec：docs/desktop/linux-close-to-tray.md）。
   * GNOME 等无 StatusNotifierWatcher 的桌面托盘不渲染且不报错，必须在隐藏前显式确认能力；
   * 空值按"不可用"安全默认，走确认退出路径，避免窗口隐藏后失联。
   */
  closeToTraySupported?: boolean;
  isLastWindow: boolean;
  label: string;
  logger: { info: (...args: unknown[]) => void };
  shouldConfirmQuit?: boolean;
  confirmQuit: () => boolean;
  requestQuit: () => void;
  hideWindow?: () => void;
}) {
  // CR 修复:win32 不能短路丢弃 closeToTraySupported——它承载 resolveCloseToTraySupported
  // 的合并裁决(Windows=托盘实例创建成功)。托盘创建失败时隐藏窗口即失联,与 spec
  // "关窗分支与设置页能力查询都读同一合并结果"保持一致。
  const canHideToTray =
    (options.platform === "win32" || options.platform === "linux") &&
    options.closeToTraySupported === true;
  if (
    canHideToTray &&
    options.closeToTray &&
    !options.forceQuit &&
    !options.explicitQuitRequested
  ) {
    options.logger.info(`[createWindow] window close hidden to tray (${options.label})`);
    options.hideWindow?.();
    return true;
  }

  if (options.platform === "darwin" || options.forceQuit || !options.isLastWindow) {
    return false;
  }

  if (options.shouldConfirmQuit === false) {
    options.logger.info(
      `[createWindow] last window close skipped confirmation, quitting app (${options.label})`,
    );
    options.requestQuit();
    return true;
  }

  if (!options.confirmQuit()) {
    options.logger.info(`[createWindow] last window close canceled by user (${options.label})`);
    return true;
  }

  options.logger.info(
    `[createWindow] last window close confirmed, quitting app (${options.label})`,
  );
  options.requestQuit();
  return true;
}
