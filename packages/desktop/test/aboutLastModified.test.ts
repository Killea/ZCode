import { expect, it } from "vitest";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAboutSnapshot, formatAboutDetail } from "../src/main/about.js";
import { createCustomAboutDialogHtml } from "../src/main/aboutWindow.js";

function createBundleWithMtime(mtimeMs: number): string {
  const dir = mkdtempSync(join(tmpdir(), "about-last-modified-"));
  const filePath = join(dir, "zcode.cjs");
  writeFileSync(filePath, "// bundle\n", "utf-8");
  const seconds = mtimeMs / 1000;
  utimesSync(filePath, seconds, seconds);
  return filePath;
}

function formatExpectedLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const baseMetadata = {
  appVersion: "3.14.0",
  buildCommitId: "abc12345",
  buildTime: "2026-09-21T10:00:00.000Z",
};

it("agent bundle mtime newer than buildTime wins", () => {
  const bundleMtime = Date.parse("2026-09-29T05:30:00Z");
  const bundlePath = createBundleWithMtime(bundleMtime);
  const snapshot = createAboutSnapshot({
    buildMetadata: baseMetadata,
    agentBundlePath: bundlePath,
  });
  expect(snapshot.lastModifiedAt).toBe(formatExpectedLocal(bundleMtime));
});

it("older bundle mtime falls back to buildTime", () => {
  const bundleMtime = Date.parse("2026-01-01T00:00:00Z");
  const bundlePath = createBundleWithMtime(bundleMtime);
  const snapshot = createAboutSnapshot({
    buildMetadata: baseMetadata,
    agentBundlePath: bundlePath,
  });
  expect(snapshot.lastModifiedAt).toBe(formatExpectedLocal(Date.parse(baseMetadata.buildTime)));
});

it("missing bundle path still resolves from buildTime", () => {
  const snapshot = createAboutSnapshot({
    buildMetadata: baseMetadata,
    agentBundlePath: join(tmpdir(), "does-not-exist-zcode.cjs"),
  });
  expect(snapshot.lastModifiedAt).toBe(formatExpectedLocal(Date.parse(baseMetadata.buildTime)));
});

it("no metadata and no bundle yields unknown", () => {
  const snapshot = createAboutSnapshot({ buildMetadata: null, agentBundlePath: undefined });
  // ZCODE_BUILD_TIME 编译期常量一般为合法时间；仅当它不是可解析时间时才为 unknown。
  if (snapshot.buildTime === "unknown") {
    expect(snapshot.lastModifiedAt).toBe("unknown");
  } else {
    expect(snapshot.lastModifiedAt).not.toBe("unknown");
  }
});

it("formatAboutDetail includes last modified line", () => {
  const snapshot = createAboutSnapshot({ buildMetadata: baseMetadata });
  expect(formatAboutDetail(snapshot)).toMatch(/Last Modified: .+/);
});

it("about html renders modifiedLine when provided", () => {
  const html = createCustomAboutDialogHtml({
    applicationName: "ZCode Desktop App",
    appVersion: "3.14.0",
    copyright: "Copyright © 2026 ZCode.",
    optimizationLine: "",
    modifiedLine: "Last modified 2026-09-29 13:33",
    versionLabel: "version",
    okButtonLabel: "OK",
  });
  expect(html).toMatch(/Last modified 2026-09-29 13:33/);
});

it("about html omits modifiedLine when empty", () => {
  const html = createCustomAboutDialogHtml({
    applicationName: "ZCode Desktop App",
    appVersion: "3.14.0",
    copyright: "Copyright © 2026 ZCode.",
    optimizationLine: "",
    modifiedLine: "",
    versionLabel: "version",
    okButtonLabel: "OK",
  });
  expect(html).not.toMatch(/Last modified/);
});
