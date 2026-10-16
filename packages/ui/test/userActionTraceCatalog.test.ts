import { describe, expect, it } from "vitest";
import {
  CORE_USER_ACTION_FEATURES,
  SETTINGS_USER_ACTION_FEATURES,
  USER_ACTION_CATALOG,
} from "../src/lib/userActionTraceCatalog.js";

describe("user action trace catalog", () => {
  it("固定 24 个 Core 与 15 个 Settings 叶子 feature", () => {
    expect(Object.keys(CORE_USER_ACTION_FEATURES)).toHaveLength(24);
    expect(Object.keys(SETTINGS_USER_ACTION_FEATURES)).toHaveLength(15);
    // 全局记忆特性（da989be6）为 workbench.file 新增 close_tree（文件树侧栏关闭），core 组 94 → 95
    expect(USER_ACTION_CATALOG.filter((entry) => entry.group === "core")).toHaveLength(95);
    // 全局记忆特性（da989be6）为 settings.memory 新增 switch_memory_tab / toggle_global_memory / save_global_memory，settings 组 44 → 47
    // 默认模式设置（docs/composer-default-mode.md）为 settings.conversation 新增 change_default_session_mode，settings 组 47 → 48
    expect(USER_ACTION_CATALOG.filter((entry) => entry.group === "settings")).toHaveLength(48);
  });

  it("feature/action 组合唯一且不使用动态标识", () => {
    const keys = USER_ACTION_CATALOG.map((entry) => `${entry.featureId}:${entry.action}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of USER_ACTION_CATALOG) {
      expect(entry.featureId).toMatch(/^[a-z]+(?:[._][a-z]+)+$/u);
      expect(entry.action).toMatch(/^[a-z]+(?:_[a-z]+)*$/u);
      expect(entry.featureId).not.toMatch(/taskId|workspacePath|pluginId/iu);
    }
  });

  it("不声明 /event/report sink", () => {
    for (const entry of USER_ACTION_CATALOG) {
      expect(entry).not.toHaveProperty("eventPolicy");
      expect(entry).not.toHaveProperty("elementName");
    }
  });
});
