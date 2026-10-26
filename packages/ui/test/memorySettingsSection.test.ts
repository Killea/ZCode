// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IMemoryService } from "@zcode/services";
import {
  TID_SETTINGS_GLOBAL_MEMORY_CREATE,
  TID_SETTINGS_GLOBAL_MEMORY_DELETE,
  TID_SETTINGS_GLOBAL_MEMORY_LIST,
  TID_SETTINGS_GLOBAL_MEMORY_PROMPT_INFO,
  TID_SETTINGS_MEMORY_COUNT,
  TID_SETTINGS_MEMORY_FILE,
  TID_SETTINGS_MEMORY_FILE_EDITOR_ACTIONS,
  TID_SETTINGS_MEMORY_FILE_ICON,
  TID_SETTINGS_MEMORY_FILE_NAME,
  TID_SETTINGS_MEMORY_FILE_UPDATED_AT,
  TID_SETTINGS_MEMORY_GLOBAL_EDITOR,
  TID_SETTINGS_MEMORY_GLOBAL_SAVE,
  TID_SETTINGS_MEMORY_SCOPE_ICON,
  TID_SETTINGS_MEMORY_SCOPE_TRIGGER,
  TID_SETTINGS_MEMORY_SEARCH_CLEAR,
  TID_SETTINGS_MEMORY_SEARCH_INPUT,
  testId,
} from "@zcode/shared";

vi.mock("@/i18n/IntlProvider.js", () => {
  // intl 引用必须跨渲染稳定：GlobalMemoryEditor/Manager 的 load/refresh
  // useCallback 以 intl 为依赖，新对象会导致 effect 循环重载。
  const intl = {
    formatMessage: ({ id }: { id: string }, values?: Record<string, string | number>) =>
      values
        ? `${id}:${Object.entries(values)
            .map(([key, value]) => `${key}=${value}`)
            .join(",")}`
        : id,
  };
  return {
    useZCodeIntl: () => ({ locale: "zh-CN", intl }),
  };
});

vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/WorkspaceEditorButtonGroup.js", () => ({
  WorkspaceEditorButtonGroup: ({ workspaceAbsPath }: { workspaceAbsPath: string }) =>
    createElement("button", {
      "data-testid": `memory-editor-${workspaceAbsPath}`,
      type: "button",
    }),
}));

vi.mock("@/settings/PluginScopeMenu.js", () => ({
  PluginScopeMenu: ({
    includeUser,
    onScopeKeyChange,
    selectedScopeKey,
    triggerIconTestId,
    triggerTestId,
    workspaceOptions,
  }: {
    includeUser: boolean;
    onScopeKeyChange: (key: string) => void;
    selectedScopeKey: string;
    triggerIconTestId: string;
    triggerTestId: string;
    workspaceOptions: Array<{ key: string; label: string }>;
  }) =>
    createElement(
      "div",
      { "data-include-user": String(includeUser) },
      createElement(
        "button",
        { "data-testid": triggerTestId, type: "button" },
        createElement("span", {
          className: "lucide-folder",
          "data-testid": triggerIconTestId,
        }),
        workspaceOptions.find((option) => option.key === selectedScopeKey)?.label,
      ),
      ...workspaceOptions.map((option) =>
        createElement(
          "button",
          {
            key: option.key,
            role: "menuitemradio",
            type: "button",
            onClick: () => onScopeKeyChange(option.key),
          },
          option.label,
        ),
      ),
    ),
}));

import { MemorySettingsSection } from "@/settings/MemorySettingsSection.js";

type MemoryCatalogService = Pick<
  IMemoryService,
  | "listProjectMemories"
  | "listGlobalMemories"
  | "readGlobalMemory"
  | "writeGlobalMemory"
  | "createGlobalMemory"
  | "deleteGlobalMemory"
>;

const globalEntries = [
  {
    id: "default",
    name: "default",
    chars: 11,
    updatedAt: 100,
  },
  {
    id: "code-style",
    name: "Code Style",
    description: "编码风格偏好",
    chars: 42,
    updatedAt: 200,
  },
];

function createGlobalEntries() {
  return globalEntries.map((entry) => ({ ...entry }));
}

const workspaces = [
  {
    id: "z-code-1111111111111111",
    label: "z-code",
    updatedAt: 20,
    files: [
      {
        name: "MEMORY.md",
        path: "/memory/z-code/MEMORY.md",
        kind: "index" as const,
        size: 12,
        updatedAt: 20,
      },
      {
        name: "fact-a.md",
        path: "/memory/z-code/fact-a.md",
        kind: "item" as const,
        size: 10,
        updatedAt: 10,
      },
    ],
  },
  {
    id: "second-2222222222222222",
    label: "second",
    updatedAt: 15,
    files: [
      {
        name: "fact-b.md",
        path: "/memory/second/fact-b.md",
        kind: "item" as const,
        size: 8,
        updatedAt: 15,
      },
    ],
  },
];

function createService(): MemoryCatalogService {
  return {
    listProjectMemories: vi.fn(async () => workspaces),
    listGlobalMemories: vi.fn(async () => createGlobalEntries()),
    readGlobalMemory: vi.fn(async ({ id }: { id: string }) => {
      const meta = globalEntries.find((entry) => entry.id === id);
      return {
        id,
        // 与真实服务同口径：无自定义 name 时回退为 id（default → "default"）。
        name: meta?.name ?? id,
        description: meta?.description,
        content: `body of ${id}`,
        chars: 10,
        updatedAt: 100,
        exists: true,
      };
    }),
    writeGlobalMemory: vi.fn(async () => ({ updatedAt: 300 })),
    createGlobalMemory: vi.fn(async ({ name }: { name: string }) => ({
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    })),
    deleteGlobalMemory: vi.fn(async () => {}),
  };
}

// 2026-10-26 起移除全局记忆总开关（默认常开、不可关闭），组件不再接收
// globalMemoryEnabled / onGlobalMemoryEnabledChange props。
function renderSection(
  memoryService: MemoryCatalogService,
  memoryEnabled = true,
  workspaceDisplayNames: readonly string[] = [],
) {
  const onMemoryEnabledChange = vi.fn(async () => {});
  render(
    createElement(MemorySettingsSection, {
      memoryEnabled,
      memoryService,
      onMemoryEnabledChange,
      projectMemoryViewerAvailable: true,
      workspaceDisplayNames,
    }),
  );
  return { onMemoryEnabledChange };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MemorySettingsSection", () => {
  it("开关位于 Workspace Scope 工具栏上方，关闭时不读取 catalog", () => {
    const memoryService = createService();
    renderSection(memoryService, false);
    expect(screen.getByRole("switch", { name: "settings.memory.workspaceMemory" })).toBeTruthy();
    expect(screen.queryByText("settings.memory.viewer.disabled")).toBeNull();
    expect(screen.queryByTestId(TID_SETTINGS_MEMORY_SCOPE_TRIGGER)).toBeNull();
    expect(memoryService.listProjectMemories).not.toHaveBeenCalled();
  });

  it("默认选择首个 Workspace 并直接显示该 Scope 的文件", async () => {
    renderSection(createService(), true, ["Z Code", "Second"]);
    const scopeTrigger = await screen.findByTestId(TID_SETTINGS_MEMORY_SCOPE_TRIGGER);
    expect(scopeTrigger.textContent).toContain("Z Code");
    expect(screen.getByTestId(TID_SETTINGS_MEMORY_SCOPE_ICON)).toBeTruthy();
    expect(screen.queryByText("User")).toBeNull();
    expect(screen.getByTestId(TID_SETTINGS_MEMORY_COUNT).textContent).toBe(
      "settings.memory.viewer.memoryCount.other:count=2",
    );
    expect(screen.getByTestId(testId(TID_SETTINGS_MEMORY_FILE, "MEMORY.md"))).toBeTruthy();
    expect(screen.getByTestId(testId(TID_SETTINGS_MEMORY_FILE_ICON, "MEMORY.md"))).toBeTruthy();
    expect(
      screen.getByTestId(testId(TID_SETTINGS_MEMORY_FILE_UPDATED_AT, "MEMORY.md")).textContent,
    ).toContain("settings.memory.viewer.updated.date");
    const fileName = screen.getByTestId(testId(TID_SETTINGS_MEMORY_FILE_NAME, "MEMORY.md"));
    expect(fileName.className).toContain("font-medium");
    expect(fileName.className).not.toContain("font-mono");
    expect(screen.getByTestId("memory-editor-/memory/z-code/MEMORY.md")).toBeTruthy();
    expect(
      screen.getByTestId(testId(TID_SETTINGS_MEMORY_FILE_EDITOR_ACTIONS, "MEMORY.md")),
    ).toBeTruthy();
    expect(screen.getByTestId(testId(TID_SETTINGS_MEMORY_FILE, "fact-a.md"))).toBeTruthy();
    expect(screen.queryByTestId(testId(TID_SETTINGS_MEMORY_FILE, "fact-b.md"))).toBeNull();
    const filesHeading = screen.getByRole("heading", {
      name: "settings.memory.viewer.files",
    });
    const filesHeader = filesHeading.parentElement;
    expect(filesHeader?.querySelector('[data-testid="settings-memory-refresh"]')).toBeTruthy();
  });

  it("Workspace Scope 按 settings.json 提供的 recentProjects 顺序排列", async () => {
    renderSection(createService(), true, ["Second", "Z Code"]);

    expect((await screen.findByTestId(TID_SETTINGS_MEMORY_SCOPE_TRIGGER)).textContent).toContain(
      "Second",
    );
    expect(screen.getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual([
      "Second",
      "Z Code",
    ]);
    expect(screen.getByTestId(testId(TID_SETTINGS_MEMORY_FILE, "fact-b.md"))).toBeTruthy();
  });

  it("Scope 菜单只列出 Workspace，切换后替换文件列表", async () => {
    renderSection(createService());
    await screen.findByTestId(TID_SETTINGS_MEMORY_SCOPE_TRIGGER);
    expect(screen.queryByRole("menuitemradio", { name: /User/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /second/ }));
    expect(screen.getByTestId(TID_SETTINGS_MEMORY_SCOPE_TRIGGER).textContent).toContain("second");
    expect(screen.getByTestId(testId(TID_SETTINGS_MEMORY_FILE, "fact-b.md"))).toBeTruthy();
    expect(screen.queryByTestId(testId(TID_SETTINGS_MEMORY_FILE, "MEMORY.md"))).toBeNull();
  });

  it("按当前 Scope 的文件名忽略大小写搜索，无结果时隐藏文件分组", async () => {
    renderSection(createService());
    const search = await screen.findByTestId(TID_SETTINGS_MEMORY_SEARCH_INPUT);

    fireEvent.change(search, { target: { value: "FACT-A" } });
    expect(screen.getByTestId(testId(TID_SETTINGS_MEMORY_FILE, "fact-a.md"))).toBeTruthy();
    expect(screen.queryByTestId(testId(TID_SETTINGS_MEMORY_FILE, "MEMORY.md"))).toBeNull();
    expect(screen.getByTestId(TID_SETTINGS_MEMORY_SEARCH_CLEAR)).toBeTruthy();
    fireEvent.click(screen.getByTestId(TID_SETTINGS_MEMORY_SEARCH_CLEAR));
    expect(screen.getByTestId(testId(TID_SETTINGS_MEMORY_FILE, "MEMORY.md"))).toBeTruthy();

    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.getByText("settings.memory.viewer.searchEmpty")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "settings.memory.viewer.files" })).toBeNull();
  });

  it("刷新保留当前 Scope；Scope 消失时回退首项", async () => {
    const memoryService = createService();
    renderSection(memoryService);
    await screen.findByTestId(TID_SETTINGS_MEMORY_SCOPE_TRIGGER);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /second/ }));
    fireEvent.click(screen.getByRole("button", { name: "settings.memory.viewer.refresh" }));
    await waitFor(() =>
      expect(screen.getByTestId(TID_SETTINGS_MEMORY_SCOPE_TRIGGER).textContent).toContain("second"),
    );

    vi.mocked(memoryService.listProjectMemories).mockResolvedValueOnce([workspaces[0]]);
    fireEvent.click(screen.getByRole("button", { name: "settings.memory.viewer.refresh" }));
    await waitFor(() =>
      expect(screen.getByTestId(TID_SETTINGS_MEMORY_SCOPE_TRIGGER).textContent).toContain("z-code"),
    );
  });

  it("保留 loading、empty 与 error 反馈", async () => {
    let resolveCatalog: ((value: []) => void) | undefined;
    const memoryService = createService();
    vi.mocked(memoryService.listProjectMemories).mockImplementationOnce(
      () => new Promise((resolve) => (resolveCatalog = resolve)),
    );
    renderSection(memoryService);
    expect(screen.getByText("settings.memory.viewer.loading")).toBeTruthy();
    resolveCatalog?.([]);
    expect(await screen.findByText("settings.memory.viewer.empty")).toBeTruthy();
  });

  it("Web Remote / Mobile 只展示开关和本地查看提示", () => {
    const memoryService = createService();
    render(
      createElement(MemorySettingsSection, {
        memoryEnabled: true,
        memoryService,
        onMemoryEnabledChange: vi.fn(async () => {}),
        projectMemoryViewerAvailable: false,
      }),
    );
    expect(screen.getByText("settings.memory.viewer.localOnly")).toBeTruthy();
    expect(memoryService.listProjectMemories).not.toHaveBeenCalled();
  });
});

async function switchToGlobalTab() {
  fireEvent.mouseDown(await screen.findByRole("tab", { name: "settings.memory.tab.global" }), {
    button: 0,
    ctrlKey: false,
  });
}

describe("MemorySettingsSection 全局记忆", () => {
  it("全局 tab 列出全部条目：default 固定首位并显示本地化名", async () => {
    const memoryService = createService();
    renderSection(memoryService);
    await switchToGlobalTab();

    await waitFor(() => expect(memoryService.listGlobalMemories).toHaveBeenCalled());
    expect(
      await screen.findByTestId(`${TID_SETTINGS_GLOBAL_MEMORY_LIST}-item-default`),
    ).toBeTruthy();
    expect(screen.getByTestId(`${TID_SETTINGS_GLOBAL_MEMORY_LIST}-item-code-style`)).toBeTruthy();
    expect(screen.getByText("settings.memory.global.defaultName")).toBeTruthy();
    expect(screen.getByText("Code Style")).toBeTruthy();
    expect(screen.getByText("编码风格偏好")).toBeTruthy();
    // info 图标说明 Prompt 注入范围；aria-label 用独立标题键，便于读屏和测试。
    expect(
      screen.getByTestId(TID_SETTINGS_GLOBAL_MEMORY_PROMPT_INFO).getAttribute("aria-label"),
    ).toBe("settings.memory.global.promptInfoTitle");
  });

  it("default 有自定义 name 时列表显示自定义名而非本地化名", async () => {
    const memoryService = createService();
    vi.mocked(memoryService.listGlobalMemories).mockImplementation(async () => [
      { id: "default", name: "开发机器", chars: 11, updatedAt: 100 },
      ...createGlobalEntries().slice(1),
    ]);
    renderSection(memoryService);
    await switchToGlobalTab();

    const item = await screen.findByTestId(`${TID_SETTINGS_GLOBAL_MEMORY_LIST}-item-default`);
    expect(item.textContent).toContain("开发机器");
    expect(item.textContent).not.toContain("settings.memory.global.defaultName");
  });

  it("default 编辑器 name 回退为空并随保存写入自定义名", async () => {
    const memoryService = createService();
    renderSection(memoryService);
    await switchToGlobalTab();
    // default 固定列表首位且加载后自动选中，编辑器已挂载，无需再点击行。
    await screen.findByTestId(`${TID_SETTINGS_GLOBAL_MEMORY_LIST}-item-default`);

    const nameInput = (await screen.findByTestId(
      `${TID_SETTINGS_MEMORY_GLOBAL_EDITOR}-name`,
    )) as HTMLInputElement;
    // 服务层 name 回退为 id 时输入框应为空，由 placeholder 呈现本地化"默认"。
    await waitFor(() => expect(nameInput.value).toBe(""));

    fireEvent.change(nameInput, { target: { value: "开发机器" } });
    fireEvent.click(screen.getByTestId(TID_SETTINGS_MEMORY_GLOBAL_SAVE));

    await waitFor(() =>
      expect(memoryService.writeGlobalMemory).toHaveBeenCalledWith({
        id: "default",
        name: "开发机器",
        description: "",
        content: "body of default",
      }),
    );
  });

  it("选中条目后加载编辑器并保存 name/description/content", async () => {
    const memoryService = createService();
    renderSection(memoryService);
    await switchToGlobalTab();
    const row = await screen.findByTestId(`${TID_SETTINGS_GLOBAL_MEMORY_LIST}-item-code-style`);
    fireEvent.click(row);

    const editor = await screen.findByTestId(TID_SETTINGS_MEMORY_GLOBAL_EDITOR);
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe("body of code-style"));
    fireEvent.change(editor, { target: { value: "rewritten body" } });
    fireEvent.click(screen.getByTestId(TID_SETTINGS_MEMORY_GLOBAL_SAVE));

    await waitFor(() =>
      expect(memoryService.writeGlobalMemory).toHaveBeenCalledWith({
        id: "code-style",
        name: "Code Style",
        description: "编码风格偏好",
        content: "rewritten body",
      }),
    );
  });

  it("新建记忆：表单提交 createGlobalMemory 并刷新列表", async () => {
    const memoryService = createService();
    renderSection(memoryService);
    await switchToGlobalTab();
    fireEvent.click(await screen.findByTestId(TID_SETTINGS_GLOBAL_MEMORY_CREATE));

    fireEvent.change(screen.getByTestId(`${TID_SETTINGS_GLOBAL_MEMORY_CREATE}-name`), {
      target: { value: "Deploy Notes" },
    });
    const contentBox = screen.getByTestId(`${TID_SETTINGS_GLOBAL_MEMORY_CREATE}-content`);
    // 内容框需要可见描边：通用 Textarea 的 border-input 在深色卡片上与背景同色。
    expect(contentBox.className).toContain("border-input-border");
    fireEvent.change(contentBox, {
      target: { value: "initial content" },
    });
    fireEvent.click(screen.getByTestId(`${TID_SETTINGS_GLOBAL_MEMORY_CREATE}-confirm`));

    await waitFor(() =>
      expect(memoryService.createGlobalMemory).toHaveBeenCalledWith({
        name: "Deploy Notes",
        content: "initial content",
      }),
    );
    await waitFor(() =>
      expect(vi.mocked(memoryService.listGlobalMemories).mock.calls.length).toBeGreaterThanOrEqual(
        2,
      ),
    );
  });

  it("新建时隐藏已选记忆的高亮与编辑器，点击条目退出新建", async () => {
    const memoryService = createService();
    renderSection(memoryService);
    await switchToGlobalTab();
    const row = await screen.findByTestId(`${TID_SETTINGS_GLOBAL_MEMORY_LIST}-item-default`);
    // 列表加载后 default 自动选中并展开编辑器。
    expect(await screen.findByTestId(TID_SETTINGS_MEMORY_GLOBAL_EDITOR)).toBeTruthy();
    expect(row.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByTestId(TID_SETTINGS_GLOBAL_MEMORY_CREATE));
    expect(screen.getByTestId(`${TID_SETTINGS_GLOBAL_MEMORY_CREATE}-name`)).toBeTruthy();
    expect(screen.queryByTestId(TID_SETTINGS_MEMORY_GLOBAL_EDITOR)).toBeNull();
    expect(row.getAttribute("aria-pressed")).toBe("false");
    expect(row.className).not.toContain("bg-accent/60");

    fireEvent.click(row);
    expect(screen.queryByTestId(`${TID_SETTINGS_GLOBAL_MEMORY_CREATE}-name`)).toBeNull();
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByTestId(TID_SETTINGS_MEMORY_GLOBAL_EDITOR)).toBeTruthy();
  });

  it("删除记忆：确认对话框后调用 deleteGlobalMemory", async () => {
    const memoryService = createService();
    renderSection(memoryService);
    await switchToGlobalTab();
    fireEvent.click(await screen.findByTestId(`${TID_SETTINGS_GLOBAL_MEMORY_DELETE}-code-style`));
    fireEvent.click(await screen.findByTestId(`${TID_SETTINGS_GLOBAL_MEMORY_DELETE}-confirm`));

    await waitFor(() =>
      expect(memoryService.deleteGlobalMemory).toHaveBeenCalledWith({
        id: "code-style",
      }),
    );
  });

  // 2026-10-26 起总开关移除（默认常开、不可关闭）：列表恒可编辑，
  // 新建/删除按钮不存在受开关门控的禁用态。
  it("总开关移除后列表恒可编辑：新建/删除始终可用", async () => {
    const memoryService = createService();
    renderSection(memoryService);
    await switchToGlobalTab();
    expect(
      await screen.findByTestId(`${TID_SETTINGS_GLOBAL_MEMORY_LIST}-item-default`),
    ).toBeTruthy();
    expect(
      (screen.getByTestId(TID_SETTINGS_GLOBAL_MEMORY_CREATE) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByTestId(`${TID_SETTINGS_GLOBAL_MEMORY_DELETE}-default`) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});
