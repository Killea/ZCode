import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const entry = "/packages/ui/test/browser/manual-review/pending/header-running-tasks.fixture.tsx";
const strip = '[data-testid="header-running-tasks"]';
const indicators = '[data-testid^="header-running-task-"]';
const overflow = '[data-testid="header-running-tasks-overflow"]';
let server, browser, origin;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "header-running-tasks-fixture",
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (!req.url?.startsWith("/fixture?")) return next();
            res.setHeader("Content-Type", "text/html");
            res.end(
              await vite.transformIndexHtml(
                req.url,
                `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`,
              ),
            );
          });
        },
      },
    ],
    resolve: { alias: { "@": `${root}packages/ui/src` } },
    optimizeDeps: { entries: [entry.slice(1)] },
    server: { host: "127.0.0.1", port: 0, watch: null, hmr: false },
  });
  await server.listen();
  origin = server.resolvedUrls.local[0];
  browser = await chromium.launch(
    process.env.CHROME_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
      : { channel: "chrome" },
  );
});
after(async () => {
  await Promise.all([
    browser?.close().then(() => console.info("Fixture browser closed")),
    server?.close().then(() => console.info("Fixture server closed")),
  ]);
});

for (const [width, locale, theme] of [
  [1200, "en-US", "dark"],
  [390, "zh-CN", "light"],
]) {
  test(`HRT-E2E-001 ${width}/${locale}/${theme}`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(120000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const selections = () => page.evaluate(() => window.__headerRunningSelections ?? []);
    try {
      await page.goto(`${origin}fixture?locale=${locale}&theme=${theme}`, {
        waitUntil: "domcontentloaded",
      });
      // 8 个在线 running：前 6 个直显，其余进 +2；completed/offline 不出现。
      await page.locator(strip).waitFor();
      assert.equal(await page.locator(indicators).count(), 6);
      const overflowButton = page.locator(overflow);
      await overflowButton.waitFor();
      assert.match((await overflowButton.textContent()) ?? "", /\+2/);

      // 当前激活会话高亮；等待权限的会话用 warning 色转圈。
      const first = page.locator(indicators).first();
      assert.match((await first.getAttribute("class")) ?? "", /bg-selected/);
      const svgs = await page.locator(`${indicators} svg`).all();
      assert.match((await svgs[1].getAttribute("class")) ?? "", /text-warning/);
      assert.doesNotMatch((await svgs[0].getAttribute("class")) ?? "", /text-warning/);

      // tooltip 显示 session 名称；远程会话附 workspace 标签。
      await first.hover();
      await page.getByRole("tooltip").waitFor();
      assert.match((await page.getByRole("tooltip").textContent()) ?? "", /Fix login crash/);
      await page.mouse.move(width / 2, 400);

      // 点击指示条 = 点击 session：透传 workspacePath/taskId/identity/remoteSessionId。
      await page.locator(indicators).nth(2).click();
      assert.deepEqual(await selections(), [["/ws-a", "t3", null, null]]);

      // 折叠菜单列出剩余 running，点击远程会话带 remoteSessionId。
      await overflowButton.click();
      await page.getByRole("menu").waitFor();
      const menuItems = page.locator(`${indicators}[role="menuitem"]`);
      assert.equal(await menuItems.count(), 2);
      await menuItems.last().click();
      assert.deepEqual(await selections(), [
        ["/ws-a", "t3", null, null],
        ["/ws-b", "t8", "ssh://devbox/ws-b", "remote-session-1"],
      ]);

      const artifacts = join(tmpdir(), "zcode-header-running-tasks");
      await mkdir(artifacts, { recursive: true });
      await page.screenshot({ path: join(artifacts, `${width}-${locale}-${theme}.png`) });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      assert.deepEqual(errors, []);
    } catch (error) {
      const diagnostic = `${String(error)}; pageErrors=${JSON.stringify(errors)}; body=${(await page.locator("body").innerText()).slice(0, 1500)}`;
      console.error(diagnostic);
      throw new Error(diagnostic, { cause: error });
    } finally {
      await page.close();
    }
  });
}
