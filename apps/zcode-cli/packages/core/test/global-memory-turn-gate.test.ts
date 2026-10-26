import assert from "node:assert/strict";
import test from "node:test";
import { createContextBuilder } from "../src/context/builder.js";
import type { ContextBuilderConfig, ContextSection } from "../src/context/types.js";
import type { GlobalMemoryEntryInjection } from "../src/memory/global-content.js";
import type { EnvInfo } from "@zcode/contracts";

// 全局记忆改为"逐条 opt-in"：总开关开启（globalMemoryDir 在场）后，默认也不注入，
// 仅当本轮 turn 快照（globalMemories）非空时才注入。这里直接对 ContextBuilder.build()
// 的门禁做契约测试，防止回退到"总开关开就每轮都注入"的旧行为。

const envInfo: EnvInfo = {
  cwd: "/tmp",
  platform: "linux",
  shell: "bash",
  osVersion: "test",
  nodeVersion: "v22",
};

const GLOBAL_DIR = "/home/u/.zcode/cli/memories/global";

const defaultEntry: GlobalMemoryEntryInjection = {
  id: "default",
  filePath: `${GLOBAL_DIR}/MEMORY.md`,
  content: "记住：用户偏好中文回复。",
};

const prefsEntry: GlobalMemoryEntryInjection = {
  id: "code-style",
  filePath: `${GLOBAL_DIR}/code-style.md`,
  content: "总是使用 strict TypeScript。",
};

function buildSections(overrides: Partial<ContextBuilderConfig>): readonly ContextSection[] {
  const config: ContextBuilderConfig = {
    workingDirectory: "/tmp",
    envInfo,
    globalMemoryDir: GLOBAL_DIR,
    ...overrides,
  };
  return createContextBuilder(config).build().sections;
}

function findGlobalMemory(sections: ReturnType<typeof buildSections>) {
  return sections.find((section) => section.source === "global_memory");
}

test("总开关开 + 本轮有条目 → 注入全局记忆段", () => {
  assert.ok(findGlobalMemory(buildSections({ globalMemories: [defaultEntry] })));
});

test("总开关开 + 本轮空选择（[]）→ 不注入", () => {
  assert.equal(findGlobalMemory(buildSections({ globalMemories: [] })), undefined);
});

test("总开关开 + 缺省（globalMemories 未传）→ 默认不注入", () => {
  assert.equal(findGlobalMemory(buildSections({})), undefined);
});

test("总开关关（无 globalMemoryDir）+ 本轮有条目 → 仍不注入", () => {
  const sections = buildSections({
    globalMemoryDir: undefined,
    globalMemories: [defaultEntry],
  });
  assert.equal(findGlobalMemory(sections), undefined);
});

test("注入的段内容为 Global Memory 且携带目录与各文件路径", () => {
  const result = createContextBuilder({
    workingDirectory: "/tmp",
    envInfo,
    globalMemoryDir: GLOBAL_DIR,
    globalMemories: [defaultEntry, prefsEntry],
  }).build();
  const section = findGlobalMemory(result.sections);
  assert.ok(section, "应存在 global_memory 段");
  assert.equal(section.name, "Global Memory");
  assert.ok(section.content.includes(GLOBAL_DIR));
  assert.ok(section.content.includes(`${GLOBAL_DIR}/MEMORY.md`));
  assert.ok(section.content.includes(`${GLOBAL_DIR}/code-style.md`));
  assert.ok(section.content.includes("记住：用户偏好中文回复。"));
  assert.ok(section.content.includes("总是使用 strict TypeScript。"));
});

test("多条记忆按选择顺序注入（ids 顺序 = 块顺序）", () => {
  const result = createContextBuilder({
    workingDirectory: "/tmp",
    envInfo,
    globalMemoryDir: GLOBAL_DIR,
    globalMemories: [prefsEntry, defaultEntry],
  }).build();
  const section = findGlobalMemory(result.sections);
  assert.ok(section);
  const firstIdx = section.content.indexOf("code-style.md");
  const secondIdx = section.content.indexOf("MEMORY.md");
  assert.ok(firstIdx > 0 && secondIdx > firstIdx, "块顺序应跟随选择顺序");
});

test("空 body 的记忆条目注入为 (empty) 占位块", () => {
  const result = createContextBuilder({
    workingDirectory: "/tmp",
    envInfo,
    globalMemoryDir: GLOBAL_DIR,
    globalMemories: [{ ...prefsEntry, content: "" }],
  }).build();
  const section = findGlobalMemory(result.sections);
  assert.ok(section);
  assert.ok(section.content.includes("(empty)"));
});
