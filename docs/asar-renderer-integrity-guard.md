# app.asar renderer 入口完整性守卫

## 背景与问题

2026-10-26 Windows 手工构建（ZCode Preview 3.15.1）出现"进程全部存活但界面空白"的故障：
main/renderer/agent 进程都在运行，日志持续写入，但窗口加载
`resources/app.asar/out/renderer/index.html` 时 `ERR_FILE_NOT_FOUND`，窗口无法显示。

根因：`electron-builder` 打包时刻，`packages/desktop/out/` 尚未被 `vite build` 完整写出
（renderer 产物迟于打包文件采集完成）。`files: ["out/**/*"]` 忠实地把半成品 `out/` 打进了
app.asar，最终 asar 里只有早先写出的静态目录，`out/renderer/index.html` 与 `out/renderer/assets/`
整体缺失。该缺陷在安装前无任何报错，用户装完才发现界面出不来。

## 规则

1. `afterPack` 阶段新增断言 `assertPackagedRendererBundle`：用
   `asar list --is-pack` 读取最终 app.asar 条目（复用 `parseAsarListWithPackState` 归一化路径），
   必须存在 `/out/renderer/index.html`，缺失时直接抛错使本次打包失败。
2. 断言在所有会重写 asar 的步骤（runtime 模块注入、sourcemap 剥离）之后执行，
   校验的是最终产物而非中间态。
3. 只校验 renderer 入口页一个条目：`index.html` 由 vite 在 renderer 构建收尾时写出，
   它的存在等价于"renderer 构建已完成"；不额外统计 assets 数量，避免对产物规模做脆弱假设。
4. 断言失败的信息必须指出"可能是 out/ 未构建完整就打包了"，引导排查构建时序而不是 asar 本身。

## 边界

- 不改变 `files` 配置、打包目录结构、asar 内容与体积。
- 不改变其他平台（macOS/Linux）的正常打包结果；三平台 asar 布局一致（均为 `/out/renderer/index.html`）。
- 不新增构建步骤或产物文件。
- 本守卫不解决"vite 未写完就进入打包"的时序根因本身；时序问题的防御在构建脚本侧
  （手工脚本必须检查每步退出码）。守卫的职责是把这类缺陷拦在安装前。

## 验收场景

1. 正常打包（out/ 完整）：断言通过，打包结果与改动前一致。
2. asar 缺 `out/renderer/index.html`（模拟：构造一个缺该条目的 asar 直接调用断言函数）：
   抛错，错误信息包含缺失条目路径与"out/ 未构建完整"提示。
3. 三平台已存在的已知良好 asar（Linux 本机 linux-unpacked、macOS dist）通过该断言。
4. `pnpm typecheck` 与 `pnpm lint` 保持干净。
