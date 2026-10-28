import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  NodeZCodeBuiltinProviderConfigSource,
  ZCODE_LOCAL_OVERLAY_FILE_NAME,
} from "../src/zcode-builtin-provider-config-source.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zcode-local-overlay-"));
  roots.push(root);
  return root;
}

function emptyRelease(revision: number) {
  return {
    schemaVersion: 1,
    revision,
    config: {
      providerConfigRules: { templateRules: [], providerRules: [] },
      modelConfigRules: {
        modelRules: [],
        modelApiRules: [],
        providerSiteRules: [],
        templateModelRules: [],
        builtinProviderModelRules: [],
      },
    },
  };
}

const DEVIN_OVERLAY = {
  schemaVersion: 1,
  config: {
    providerConfigRules: {
      templateRules: [
        {
          templateId: "devin-acp",
          templateNameMap: { "en-US": "Devin" },
          config: {
            access: { type: "devin-acp" },
            api: { type: "devin-acp", baseUrl: "acp://devin" },
            builtinModelIds: ["swe-2-max"],
          },
        },
      ],
      providerRules: [],
    },
    modelConfigRules: {
      modelRules: [],
      modelApiRules: [
        {
          modelMatch: ".*",
          apiTypeMatch: "devin-acp",
          config: { optionSpecs: { maxOutputTokens: { map: "{}" } } },
        },
      ],
      providerSiteRules: [],
      templateModelRules: [
        { templateId: "devin-acp", modelId: "swe-2-max", config: { enabled: true } },
      ],
      builtinProviderModelRules: [],
    },
  },
};

async function writeJson(path: string, value: unknown) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
}

describe("ZCode Built-in 本地 Overlay", () => {
  it("同目录 Overlay 在快照层叠加 Template 与 Model 规则", async () => {
    const root = await makeRoot();
    const bundled = join(root, "zcode-builtin.json");
    await writeJson(bundled, emptyRelease(3));
    await writeJson(join(root, ZCODE_LOCAL_OVERLAY_FILE_NAME), DEVIN_OVERLAY);
    const source = new NodeZCodeBuiltinProviderConfigSource({
      bundledFilePath: bundled,
      watch: false,
    });
    try {
      const snapshot = await source.read();
      expect(snapshot.providerTemplates?.has("devin-acp")).toBe(true);
      const model = snapshot.models.resolve({
        providerId: "p",
        modelId: "swe-2-max",
        apiType: "devin-acp",
      });
      expect(model.optionSpecs?.maxOutputTokens?.map).toBe("{}");
      expect(snapshot.revision).toMatch(/^zcode-builtin:3:[a-f0-9]{64}$/u);
    } finally {
      source.dispose();
    }
  });

  it("更高 revision 的远端 Release 应用后 Overlay 仍然生效", async () => {
    const root = await makeRoot();
    const bundled = join(root, "bundled", "zcode-builtin.json");
    const active = join(root, "active", "zcode-builtin.json");
    await writeJson(bundled, emptyRelease(3));
    await writeJson(join(root, "bundled", ZCODE_LOCAL_OVERLAY_FILE_NAME), DEVIN_OVERLAY);
    const source = new NodeZCodeBuiltinProviderConfigSource({
      bundledFilePath: bundled,
      activeFilePath: active,
      watch: false,
    });
    try {
      // 模拟远端下发更新：Active 写入更高 revision 的 Release（无 devin 内容）。
      await writeJson(active, emptyRelease(9));
      const snapshot = await source.read();
      expect(snapshot.providerTemplates?.has("devin-acp")).toBe(true);
      expect(snapshot.revision.startsWith("zcode-builtin:9:")).toBe(true);
    } finally {
      source.dispose();
    }
  });

  it("Overlay 缺失时行为与原有一致", async () => {
    const root = await makeRoot();
    const bundled = join(root, "zcode-builtin.json");
    await writeJson(bundled, emptyRelease(2));
    const source = new NodeZCodeBuiltinProviderConfigSource({
      bundledFilePath: bundled,
      watch: false,
    });
    try {
      const snapshot = await source.read();
      expect(snapshot.providerTemplates?.has("devin-acp")).toBe(false);
    } finally {
      source.dispose();
    }
  });

  it("localOverlayFilePath: null 显式禁用 Overlay", async () => {
    const root = await makeRoot();
    const bundled = join(root, "zcode-builtin.json");
    await writeJson(bundled, emptyRelease(2));
    await writeJson(join(root, ZCODE_LOCAL_OVERLAY_FILE_NAME), DEVIN_OVERLAY);
    const source = new NodeZCodeBuiltinProviderConfigSource({
      bundledFilePath: bundled,
      localOverlayFilePath: null,
      watch: false,
    });
    try {
      const snapshot = await source.read();
      expect(snapshot.providerTemplates?.has("devin-acp")).toBe(false);
    } finally {
      source.dispose();
    }
  });

  it("Overlay 随行物化到 Active 目录，Agent 侧同目录查找命中", async () => {
    const root = await makeRoot();
    const bundledDir = join(root, "bundled");
    const activeDir = join(root, "active");
    const bundled = join(bundledDir, "zcode-builtin.json");
    const active = join(activeDir, "zcode-builtin.json");
    await writeJson(bundled, emptyRelease(5));
    await writeJson(join(bundledDir, ZCODE_LOCAL_OVERLAY_FILE_NAME), DEVIN_OVERLAY);
    const host = new NodeZCodeBuiltinProviderConfigSource({
      bundledFilePath: bundled,
      activeFilePath: active,
      watch: false,
    });
    try {
      await host.read();
      // Agent 进程只拿到 Active 路径；其同目录默认 Overlay 查找应命中随行副本。
      const agent = new NodeZCodeBuiltinProviderConfigSource({
        bundledFilePath: active,
        watch: false,
      });
      try {
        const snapshot = await agent.read();
        expect(snapshot.providerTemplates?.has("devin-acp")).toBe(true);
      } finally {
        agent.dispose();
      }
      const materialized = JSON.parse(
        await readFile(join(activeDir, ZCODE_LOCAL_OVERLAY_FILE_NAME), "utf8"),
      );
      expect(materialized.schemaVersion).toBe(1);
    } finally {
      host.dispose();
    }
  });

  it("Overlay 文件非法时向上抛错", async () => {
    const root = await makeRoot();
    const bundled = join(root, "zcode-builtin.json");
    await writeJson(bundled, emptyRelease(1));
    await writeFile(join(root, ZCODE_LOCAL_OVERLAY_FILE_NAME), "{broken", "utf8");
    const source = new NodeZCodeBuiltinProviderConfigSource({
      bundledFilePath: bundled,
      watch: false,
    });
    try {
      await expect(source.read()).rejects.toThrow();
    } finally {
      source.dispose();
    }
  });
});
