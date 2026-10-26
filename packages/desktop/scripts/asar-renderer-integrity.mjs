import { parseAsarListWithPackState } from "./desktop-native-package-policy.mjs";

// renderer 入口页在 app.asar 内的归一化路径（asar list 条目以 "/" 开头）。
export const RENDERER_ENTRY_PAGE_PATH = "/out/renderer/index.html";

// 返回缺失的 renderer 条目描述列表；空列表表示 asar 包含 renderer 入口页。
// 条目列表本身为空同样视为缺失——此时 asar list 解析结果不可信，必须让打包失败而不是静默通过。
export function findMissingRendererEntryPages(asarListOutput) {
  const entries = parseAsarListWithPackState(asarListOutput);
  if (entries.length === 0) {
    return ["<asar 条目列表为空>", RENDERER_ENTRY_PAGE_PATH];
  }
  return entries.some((entry) => entry.path === RENDERER_ENTRY_PAGE_PATH)
    ? []
    : [RENDERER_ENTRY_PAGE_PATH];
}

export function assertRendererEntryPagePresent(asarListOutput) {
  const missing = findMissingRendererEntryPages(asarListOutput);
  if (missing.length > 0) {
    // renderer 入口页缺失时窗口加载 index.html 会直接 ERR_FILE_NOT_FOUND，
    // 表现为"进程都活着但界面空白"（2026-10-26 Windows 构建把 vite 未写完的 out/ 打进 asar）。
    // 错误信息必须指向构建时序，而不是 asar 工具本身。
    throw new Error(
      `app.asar 缺少 renderer 入口页 ${RENDERER_ENTRY_PAGE_PATH}（缺失项: ${missing.join(", ")}）：` +
        "可能是 out/ 未构建完整就进入了打包，请检查桌面构建步骤的退出码与产物完整性",
    );
  }
}
