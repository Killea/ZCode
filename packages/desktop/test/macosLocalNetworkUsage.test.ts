import { expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  injectPlistStringEntry,
  MACOS_LOCAL_NETWORK_USAGE_KEY,
  macosLocalNetworkUsageDescription,
  patchMacBundleLocalNetworkUsage,
} from "../scripts/macos-local-network-usage.mjs";

const MINIMAL_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleIdentifier</key>
\t<string>dev.zcode.app.preview</string>
</dict>
</plist>
`;

function createFakeAppBundle(): string {
  const appPath = mkdtempSync(join(tmpdir(), "local-network-app-"));
  mkdirSync(join(appPath, "Contents", "Frameworks", "ZCode Helper.app", "Contents"), {
    recursive: true,
  });
  mkdirSync(join(appPath, "Contents", "Frameworks", "not-an-app.txt"), { recursive: true });
  writeFileSync(join(appPath, "Contents", "Info.plist"), MINIMAL_PLIST, "utf-8");
  writeFileSync(
    join(appPath, "Contents", "Frameworks", "ZCode Helper.app", "Contents", "Info.plist"),
    MINIMAL_PLIST.replace("dev.zcode.app.preview", "dev.zcode.app.preview.helper"),
    "utf-8",
  );
  return appPath;
}

it("injectPlistStringEntry appends key before root dict close", () => {
  const patched = injectPlistStringEntry(MINIMAL_PLIST, MACOS_LOCAL_NETWORK_USAGE_KEY, "desc");
  const keyIndex = patched.indexOf(`<key>${MACOS_LOCAL_NETWORK_USAGE_KEY}</key>`);
  const dictClose = patched.lastIndexOf("</dict>");
  expect(keyIndex > 0 && keyIndex < dictClose).toBeTruthy();
  expect(patched.includes("<string>desc</string>")).toBeTruthy();
});

it("injectPlistStringEntry replaces existing value instead of duplicating", () => {
  const once = injectPlistStringEntry(MINIMAL_PLIST, MACOS_LOCAL_NETWORK_USAGE_KEY, "old");
  const twice = injectPlistStringEntry(once, MACOS_LOCAL_NETWORK_USAGE_KEY, "new");
  expect(twice.split(MACOS_LOCAL_NETWORK_USAGE_KEY).length - 1).toBe(1);
  expect(twice.includes("<string>new</string>")).toBeTruthy();
  expect(!twice.includes("<string>old</string>")).toBeTruthy();
});

it("injectPlistStringEntry rejects non-XML plist content", () => {
  expect(() => injectPlistStringEntry("bplist00garbage", "k", "v")).toThrow(/root dict/);
});

it("description follows product name", () => {
  expect(macosLocalNetworkUsageDescription("ZCode Preview").includes("ZCode Preview")).toBeTruthy();
});

it("patchMacBundleLocalNetworkUsage covers main app and helper bundles", async () => {
  const appPath = createFakeAppBundle();
  const patched = await patchMacBundleLocalNetworkUsage({
    appPath,
    description: "desc",
  });
  expect(patched.length).toBe(2);
  for (const plistPath of patched) {
    const content = readFileSync(plistPath, "utf8");
    expect(content.includes(`<key>${MACOS_LOCAL_NETWORK_USAGE_KEY}</key>`)).toBeTruthy();
    expect(content.includes("<string>desc</string>")).toBeTruthy();
  }
});

it("patchMacBundleLocalNetworkUsage throws when Frameworks directory is missing", async () => {
  // 传错 appPath（例如把 Electron 框架品牌名当产品名）时 Frameworks 目录不存在，
  // 必须显式抛错而不是静默只处理主 app，否则 Helper 声明缺失且构建仍然成功。
  const appPath = mkdtempSync(join(tmpdir(), "local-network-no-frameworks-"));
  mkdirSync(join(appPath, "Contents"), { recursive: true });
  writeFileSync(join(appPath, "Contents", "Info.plist"), MINIMAL_PLIST, "utf8");
  await expect(patchMacBundleLocalNetworkUsage({ appPath, description: "desc" })).rejects.toThrow(
    /Frameworks/,
  );
});
