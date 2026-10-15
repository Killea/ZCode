import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DesktopWindowFrame } from "@/DesktopWindowFrame.js";

describe("DesktopWindowFrame", () => {
  it("uses an opaque root surface on Linux desktop", () => {
    const html = renderToStaticMarkup(
      createElement(
        DesktopWindowFrame,
        {
          title: "ZCode",
          isDesktop: true,
          isMacDesktop: false,
          isWindowsDesktop: false,
        },
        createElement("div", null, "content"),
      ),
    );

    // Bugfix: Linux 没有系统级磨砂材质兜底，根框架不能使用带透明混色的 alt 背景。
    expect(html).toContain("bg-background-win-alt");
    expect(html).not.toContain("bg-background-alt");
    expect(html).toContain('data-desktop-window-frame="true"');
    // 界面直角化（DESIGN.md「Radius」）后统一 0px：基态即 inset(0) 全尺寸裁切，
    // 最大化不再需要单独的 clip-path 覆盖。
    expect(html).toContain("rounded-none");
    expect(html).toContain("[clip-path:inset(0)]");
    expect(html).not.toContain("platform-linux-window-maximized");
  });

  it("uses an opaque root surface in the browser shell", () => {
    const html = renderToStaticMarkup(
      createElement(
        DesktopWindowFrame,
        {
          title: "ZCode",
        },
        createElement("div", null, "content"),
      ),
    );

    // Bugfix: Web 端没有 Electron/macOS 的 vibrancy 底层，半透明 alt 背景会直接叠到浏览器底色上。
    expect(html).toContain("bg-background-win-alt");
    expect(html).not.toContain("bg-background-alt");
  });
});

it.each([
  { platform: "macOS", isMacDesktop: true, isWindowsDesktop: false, opaque: false },
  { platform: "Windows", isMacDesktop: false, isWindowsDesktop: true, opaque: true },
])(
  "preserves the $platform root background contract",
  ({ isMacDesktop, isWindowsDesktop, opaque }) => {
    const html = renderToStaticMarkup(
      createElement(DesktopWindowFrame, {
        title: "ZCode",
        isDesktop: true,
        isMacDesktop,
        isWindowsDesktop,
        children: createElement("div", null, "content"),
      }),
    );
    expect(html.includes("bg-background-alt")).toBe(!opaque);
    expect(html.includes("bg-background-win-alt")).toBe(opaque);
  },
);
