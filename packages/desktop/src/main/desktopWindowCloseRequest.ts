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
  closeToTrayOnWindows?: boolean;
  isLastWindow: boolean;
  label: string;
  logger: { info: (...args: unknown[]) => void };
  shouldConfirmQuit?: boolean;
  confirmQuit: () => boolean;
  requestQuit: () => void;
  hideWindow?: () => void;
}) {
  if (
    options.platform === "win32" &&
    options.closeToTrayOnWindows &&
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
