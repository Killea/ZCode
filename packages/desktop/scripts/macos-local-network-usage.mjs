import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// macOS Sequoia 起，访问局域网（私网地址）受 Local Network 隐私策略约束：
// 未授权进程发出的私网 SYN 会被 NECP 直接丢弃，上层表现为 connect EHOSTUNREACH。
// 触发系统授权弹窗的前提是发起连接进程的 bundle Info.plist 声明
// NSLocalNetworkUsageDescription；缺失该 key 时系统不提示、默认拒绝。
// 归因按发起连接的进程签名身份判定（打包态 agent 跑在
// `ELECTRON_RUN_AS_NODE` 的 Helper 进程里，身份是 Helper 子 bundle），
// 因此主 app 与 Contents/Frameworks 下全部 Helper 子 bundle 都要声明。
export const MACOS_LOCAL_NETWORK_USAGE_KEY = "NSLocalNetworkUsageDescription";

export function macosLocalNetworkUsageDescription(productName) {
  return `${productName} needs local network access to reach self-hosted model providers and devices on your local network.`;
}

function escapePlistXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
}

/**
 * 在 XML plist 文本中 upsert 一个 string 键值对：已有 key 时替换其 <string>，
 * 否则插到根 dict 末尾（与 appendProtocolDeclaration 同约定）。二进制 plist
 * 或缺少根 </dict> 时直接抛错——打包期宁可 fail loud 也不能静默产出损坏 plist。
 */
export function injectPlistStringEntry(plist, key, value) {
  const escaped = escapePlistXml(value);
  const existing = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`, "u");
  if (existing.test(plist)) {
    return plist.replace(existing, (_match, prefix, suffix) => `${prefix}${escaped}${suffix}`);
  }
  const closingDictIndex = plist.lastIndexOf("</dict>");
  if (!plist.includes("<plist") || closingDictIndex < 0) {
    throw new Error("Info.plist is not an XML plist or is missing its root dict");
  }
  const entry = `\n\t<key>${key}</key>\n\t<string>${escaped}</string>\n`;
  return `${plist.slice(0, closingDictIndex)}${entry}${plist.slice(closingDictIndex)}`;
}

/**
 * 给一个已落盘的 .app bundle（主包 + Frameworks 下全部 Helper 子包）声明
 * Local Network usage description。electron-builder 的 extendInfo 只能写主 app
 * plist，Helper plist 没有官方配置入口，只能 afterPack / dev 复制后兜底覆盖。
 * 返回实际检查并确保声明到位的 plist 路径列表。
 */
export async function patchMacBundleLocalNetworkUsage({ appPath, description }) {
  const frameworksDir = join(appPath, "Contents", "Frameworks");
  const candidates = [join(appPath, "Contents", "Info.plist")];
  // 调用方传错 appPath 时（如把 Electron 框架品牌名当产品名）Frameworks 目录不存在。
  // 这里必须 fail loud：静默跳过会让 Local Network 声明缺失且构建仍成功，
  // LAN 推理端点在用户机器上表现为 EHOSTUNREACH，事后极难排查。
  const frameworkEntries = await readdir(frameworksDir, { withFileTypes: true });
  for (const entry of frameworkEntries) {
    if (entry.isDirectory() && entry.name.endsWith(".app")) {
      candidates.push(join(frameworksDir, entry.name, "Contents", "Info.plist"));
    }
  }

  const patched = [];
  for (const plistPath of candidates) {
    const plist = await readFile(plistPath, "utf8").catch(() => undefined);
    if (plist === undefined) continue;
    const next = injectPlistStringEntry(plist, MACOS_LOCAL_NETWORK_USAGE_KEY, description);
    if (next !== plist) {
      await writeFile(plistPath, next, "utf8");
    }
    patched.push(plistPath);
  }
  return patched;
}
