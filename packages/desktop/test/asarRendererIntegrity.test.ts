import { describe, expect, it } from "vitest";
import {
  assertRendererEntryPagePresent,
  findMissingRendererEntryPages,
  RENDERER_ENTRY_PAGE_PATH,
} from "../scripts/asar-renderer-integrity.mjs";

// asar list --is-pack 输出契约：每行 "pack: <path>" 或 "unpack: <path>"，
// Windows 上条目分隔符是反斜杠，归一化由 parseAsarListWithPackState 负责。
const GOOD_LIST = [
  "pack: /package.json",
  "pack: /out/main/index.js",
  "pack: /out/renderer/index.html",
  "pack: /out/renderer/assets/index-abc123.js",
  "pack: /node_modules/undici/index.js",
].join("\n");

const WINDOWS_STYLE_GOOD_LIST = [
  "pack: \\package.json",
  "pack: \\out\\main\\index.js",
  "pack: \\out\\renderer\\index.html",
  "pack: \\out\\renderer\\assets\\index-abc123.js",
].join("\n");

const MISSING_RENDERER_LIST = [
  "pack: /package.json",
  "pack: /out/main/index.js",
  "pack: /out/renderer/material-icons/abap.svg",
].join("\n");

describe("app.asar renderer 入口页完整性守卫", () => {
  it("renderer 入口页存在时通过", () => {
    expect(findMissingRendererEntryPages(GOOD_LIST)).toEqual([]);
    expect(() => assertRendererEntryPagePresent(GOOD_LIST)).not.toThrow();
  });

  it("Windows 反斜杠条目归一化后同样通过", () => {
    expect(findMissingRendererEntryPages(WINDOWS_STYLE_GOOD_LIST)).toEqual([]);
  });

  it("缺 index.html（只打包了静态目录）时判定缺失", () => {
    expect(findMissingRendererEntryPages(MISSING_RENDERER_LIST)).toEqual([
      RENDERER_ENTRY_PAGE_PATH,
    ]);
  });

  it("缺 index.html 时抛错且信息指向构建时序", () => {
    expect(() => assertRendererEntryPagePresent(MISSING_RENDERER_LIST)).toThrow(
      /app\.asar 缺少 renderer 入口页 \/out\/renderer\/index\.html.*out\/ 未构建完整/,
    );
  });

  it("空条目列表不静默通过", () => {
    expect(findMissingRendererEntryPages("")).toEqual([
      "<asar 条目列表为空>",
      RENDERER_ENTRY_PAGE_PATH,
    ]);
    expect(() => assertRendererEntryPagePresent("")).toThrow(
      /app\.asar 缺少 renderer 入口页/,
    );
  });
});
