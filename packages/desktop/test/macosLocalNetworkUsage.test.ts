import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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

test("injectPlistStringEntry appends key before root dict close", () => {
  const patched = injectPlistStringEntry(MINIMAL_PLIST, MACOS_LOCAL_NETWORK_USAGE_KEY, "desc");
  const keyIndex = patched.indexOf(`<key>${MACOS_LOCAL_NETWORK_USAGE_KEY}</key>`);
  const dictClose = patched.lastIndexOf("</dict>");
  assert.ok(keyIndex > 0 && keyIndex < dictClose);
  assert.ok(patched.includes("<string>desc</string>"));
});

test("injectPlistStringEntry replaces existing value instead of duplicating", () => {
  const once = injectPlistStringEntry(MINIMAL_PLIST, MACOS_LOCAL_NETWORK_USAGE_KEY, "old");
  const twice = injectPlistStringEntry(once, MACOS_LOCAL_NETWORK_USAGE_KEY, "new");
  assert.equal(twice.split(MACOS_LOCAL_NETWORK_USAGE_KEY).length - 1, 1);
  assert.ok(twice.includes("<string>new</string>"));
  assert.ok(!twice.includes("<string>old</string>"));
});

test("injectPlistStringEntry rejects non-XML plist content", () => {
  assert.throws(() => injectPlistStringEntry("bplist00garbage", "k", "v"), /root dict/);
});

test("description follows product name", () => {
  assert.ok(macosLocalNetworkUsageDescription("ZCode Preview").includes("ZCode Preview"));
});

test("patchMacBundleLocalNetworkUsage covers main app and helper bundles", async () => {
  const appPath = createFakeAppBundle();
  const patched = await patchMacBundleLocalNetworkUsage({
    appPath,
    description: "desc",
  });
  assert.equal(patched.length, 2);
  for (const plistPath of patched) {
    const content = readFileSync(plistPath, "utf-8");
    assert.ok(content.includes(`<key>${MACOS_LOCAL_NETWORK_USAGE_KEY}</key>`));
    assert.ok(content.includes("<string>desc</string>"));
  }
});
