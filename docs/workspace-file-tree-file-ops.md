# Workspace 文件树文件操作

状态：草案。关联 `docs/workspace-files-side-pane.md`（文件树的两处挂载形态）。

## 目标

为 `WorkspaceFileTree` 增加 VS Code 风格的基础文件操作：新建文件、新建文件夹、
重命名、删除。两处挂载（Sidebar 覆盖层与 Side Pane `file-tree` tab）复用同一
组件，一次实现两处生效；远程 workspace 经既有 RPC 路由到对应 Host。

## 产品规则

1. 操作集固定四件：新建文件、新建文件夹、重命名（仅同目录改名）、删除。
   不提供移动/复制/剪切；重命名输入不允许路径分隔符。
2. 删除为永久删除（`fs.rm`），不进回收站；必须经确认对话框二次确认。
   对话框展示目标名称与类型；目录额外提示其内容将被一并删除。
   远程 Host 无可靠桌面回收站，统一永久删除保证本地/远程语义一致。
3. 新建入口三处：
   - 树头部工具栏 FilePlus/FolderPlus 图标 → 在 workspace 根目录新建；
   - 目录行右键 → 在该目录内新建（目录先自动展开）；
   - 文件行右键 → 在其父目录新建（同级兄弟位置）。
4. 重命名入口：行右键菜单「重命名」+ F2 快捷键；删除入口：右键菜单 +
   Delete 快捷键（均需行焦点）。删除键在输入态不生效。
5. 行内编辑（create/rename 共用）：名称位置替换为 Input，自动聚焦并选中
   basename（不含扩展名的部分，与 VS Code 一致）；Enter 提交、Escape 取消、
   blur 提交。服务错误时保持编辑态并 toast 提示，由用户修正或取消。
6. 校验（UI 与服务层双份，服务层为准）：
   - 名称非空；不允许 `/`、`\`、NUL；不允许 `.` / `..`；
   - 解析后目标路径必须严格位于 `rootPath` 之内（防 `..` 逃逸与根目录
     本身的删除/重命名）；
   - 新建与重命名目标已存在时报错，不覆盖（POSIX rename 默认覆盖语义
     需显式拒绝）。
7. 禁用条件：
   - git-deleted 虚拟行、搜索/草稿行不可操作；
   - read-only / 断连远程场景由服务调用失败兜底（toast），不额外隐藏入口；
   - office 模式整体无文件树入口，无需单独守卫。
8. 成功后刷新：主动 `loadDirectory(parentPath)` 重载父目录（不依赖
   watcher 时序），watcher 变更通知作为兜底；新建/重命名成功后选中并
   reveal 新路径（沿用既有 reveal 机制）；被删除行若为 selectedPath
   则清空选择。

## 状态归属

- `editingSession`、`pendingDelete`、inline error：归属 `WorkspaceFileTree`
  组件本地 state，唯一写入路径为组件内 handler；不落盘、不跨 workspace
  保留（workspace 切换沿用既有 generation 重置顺带丢弃）。
- 服务写入唯一入口：`IFileService`（`packages/services/src/file`）。
  UI 经 `useWorkspaceServices` 访问，不直接 import fs。

## 服务接口（新增）

```ts
createWorkspaceEntry(params: {
  rootPath: string;
  parentPath: string;
  name: string;
  kind: "file" | "directory";
}): Promise<{ path: string }>; // 文件用独占创建（EEXIST 报错），目录 mkdir

renameWorkspaceEntry(params: {
  rootPath: string;
  path: string;
  newName: string;
}): Promise<{ path: string }>; // 仅同目录改名；目标已存在则报错

deleteWorkspaceEntry(params: {
  rootPath: string;
  path: string;
}): Promise<void>; // fs.rm recursive；拒绝删除 rootPath 本身
```

三个方法都在服务侧做 `resolve` 归一化 + 根内含校验 + 名称校验。
RPC descriptor 按方法名分发，远程 Host 自动获得同等能力。

## 事件顺序

create/rename：menu/shortcut → setEditingSession →（create: 注入草稿行至
visibleRows、expand parent）→ Input commit → fileService 调用 → 成功：
loadDirectory(parent) + select/reveal 新路径 + 清 editingSession；
失败：toast + 保留编辑态。

delete：menu/Delete 键 → pendingDelete → AlertDialog confirm →
fileService.deleteWorkspaceEntry → 成功：loadDirectory(parent) +
清 pendingDelete + 必要时清 selectedPath；失败：toast + 关对话框。

## 验收场景

- 根目录新建文件/文件夹：头部图标 → 草稿行出现在列表顶部 → 输入名称 →
  回车后树中出现新条目并被选中。
- 目录内新建：目录右键 → 自动展开并出现子级草稿行。
- 重命名：F2 或右键 → 行内 Input 预选 basename → 提交后同目录改名，
  Git 状态列正确显示。
- 删除：右键/Delete → 确认对话框 → 条目消失；目录删除递归生效。
- 非法输入：空名/含分隔符/与现有条目重名 → 不退出编辑态并提示。
- 逃逸防护：`../`、绝对路径名被服务层拒绝（单测覆盖）。
- 远程 workspace：同一组操作经远端 Host 生效，UI 无差异化代码。
- 幂等：watcher 刷新与服务主动刷新并发不丢新条目、不重复报错。

## 测试

- `packages/services/test/`：tmpdir 集成测试覆盖 create/rename/delete 及
  根内校验拒绝路径（逃逸、删根、重名覆盖、非法名）。
- `packages/ui/test/`：纯函数单测覆盖名称校验与草稿行注入位置
  （根顶部 / 展开目录内 / 折叠目录强制展开后的位置）。
