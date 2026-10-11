import assert from "node:assert/strict";
import test from "node:test";
import { createContextBuilder } from "../src/context/builder.js";
import type { ContextBuilderConfig } from "../src/context/types.js";
import type { EnvInfo } from "@zcode/contracts";

// 全局记忆改为"逐条 opt-in"：总开关开启（globalMemoryFile 在场）后，默认也不注入，
// 仅当本轮 globalMemoryIncluded 为 true 时才注入。这里直接对 ContextBuilder.build()
// 的门禁做契约测试，防止回退到"总开关开就每轮都注入"的旧行为。

const envInfo: EnvInfo = {
  cwd: "/tmp",
  platform: "linux",
  shell: "bash",
  osVersion: "test",
  nodeVersion: "v22",
};

function buildSections(overrides: Partial<ContextBuilderConfig>): ReadonlyArray<{
  source: string;
  name: string;
}> {
  const config: ContextBuilderConfig = {
    workingDirectory: "/tmp",
    envInfo,
    globalMemoryFile: "/home/u/.zcode/cli/memories/global/MEMORY.md",
    globalMemoryContent: "记住：用户偏好中文回复。",
    ...overrides,
  };
  return createContextBuilder(config).build().sections;
}

function hasGlobalMemory(sections: ReturnType<typeof buildSections>): boolean {
  return sections.some((section) => section.source === "global_memory");
}

test("总开关开 + 本轮 opt-in（globalMemoryIncluded=true）→ 注入全局记忆段", () => {
  assert.equal(hasGlobalMemory(buildSections({ globalMemoryIncluded: true })), true);
});

test("总开关开 + 本轮未 opt-in（globalMemoryIncluded=false）→ 不注入", () => {
  assert.equal(hasGlobalMemory(buildSections({ globalMemoryIncluded: false })), false);
});

test("总开关开 + 缺省（globalMemoryIncluded 未传）→ 默认不注入", () => {
  assert.equal(hasGlobalMemory(buildSections({})), false);
});

test("总开关关（无 globalMemoryFile）+ 本轮 opt-in → 仍不注入", () => {
  const sections = buildSections({
    globalMemoryFile: undefined,
    globalMemoryContent: undefined,
    globalMemoryIncluded: true,
  });
  assert.equal(hasGlobalMemory(sections), false);
});

test("注入的段内容为 Global Memory 且携带文件路径", () => {
  const result = createContextBuilder({
    workingDirectory: "/tmp",
    envInfo,
    globalMemoryFile: "/home/u/.zcode/cli/memories/global/MEMORY.md",
    globalMemoryContent: "记住：用户偏好中文回复。",
    globalMemoryIncluded: true,
  }).build();
  const section = result.sections.find((s) => s.source === "global_memory");
  assert.ok(section, "应存在 global_memory 段");
  assert.equal(section.name, "Global Memory");
  assert.ok(section.content.includes("/home/u/.zcode/cli/memories/global/MEMORY.md"));
  assert.ok(section.content.includes("记住：用户偏好中文回复。"));
});
