import assert from "node:assert/strict";
import test from "node:test";
import { manualModelConfigSchema } from "@zcode/provider";
import { modelPropertiesDataSchema } from "@zcode/shared/model-config";
import type { ProviderSettingsFormModel } from "../src/lib/providerSettingsFormTypes.js";
import {
  createProviderModelDraftValues,
  resolveProviderModelDraftCommit,
  type ProviderModelDraftValues,
} from "../src/settings/model-provider-section/ProviderModelMetadata.js";

const baseProperties = {
  contextWindow: 200_000,
  inputFormat: {
    supportsText: true,
    supportsImage: false,
    supportsVideo: false,
    supportsAudio: false,
    supportsPdf: false,
  },
  outputFormat: { supportsText: true },
  supportsToolCall: true,
  supportsJsonSchemaOutput: false,
  supportsNativeWebSearch: false,
  supportsMidConversationSystem: false,
  requiresMfjsToolSchema: false,
};

function createModelFixture(
  overrides: Partial<ProviderSettingsFormModel> = {},
): ProviderSettingsFormModel {
  return {
    kind: "candidate",
    modelId: "test-model",
    builtin: false,
    personalConfig: {},
    useRecommendedConfig: false,
    config: {
      enabled: true,
      properties: { ...baseProperties },
      optionSpecs: {
        reasoningLevel: { values: ["disabled", "enabled"], map: "{}" },
        maxOutputTokens: { max: 32_000 },
      },
    },
    hasPersonalConfig: false,
    executable: true,
    selectable: true,
    ...overrides,
  };
}

function createDraftFixture(
  overrides: Partial<ProviderModelDraftValues> = {},
): ProviderModelDraftValues {
  return {
    idValue: "test-model",
    contextWindowValue: "200000",
    maxOutputTokensValue: "32000",
    streamIdleTimeoutValue: "",
    inputFormatValue: {
      supportsText: true,
      supportsImage: false,
      supportsVideo: false,
      supportsAudio: false,
      supportsPdf: false,
    },
    enabledValue: true,
    useRecommendedConfigValue: false,
    reasoningLevelValuesValue: ["disabled", "enabled"],
    reasoningLevelMapValue: "{}",
    ...overrides,
  };
}

test("streamIdleTimeoutMs is accepted by the sparse and manual model config schemas", () => {
  assert.equal(
    modelPropertiesDataSchema.parse({ streamIdleTimeoutMs: 1_800_000 }).streamIdleTimeoutMs,
    1_800_000,
  );
  // manualModelConfigSchema 校验的是物化后的完整手动配置，所有可编辑叶子都必须在场。
  const manual = manualModelConfigSchema.parse({
    properties: {
      contextWindow: 200_000,
      supportsJsonSchemaOutput: false,
      supportsNativeWebSearch: false,
      supportsMidConversationSystem: false,
      streamIdleTimeoutMs: 120_000,
      inputFormat: { supportsImage: false, supportsVideo: false, supportsPdf: false },
    },
    optionSpecs: {
      reasoningLevel: { values: ["disabled", "enabled"], map: "{}" },
      maxOutputTokens: { max: 32_000 },
    },
  });
  assert.equal(manual.properties?.streamIdleTimeoutMs, 120_000);
});

test("draft roundtrip renders a personal timeout override in seconds", () => {
  const model = createModelFixture({
    personalConfig: { properties: { streamIdleTimeoutMs: 1_800_000 } },
  });
  assert.equal(createProviderModelDraftValues(model).streamIdleTimeoutValue, "1800");
});

test("commit stores seconds as streamIdleTimeoutMs milliseconds in the personal overlay", () => {
  const result = resolveProviderModelDraftCommit({
    currentModel: createModelFixture(),
    draft: createDraftFixture({ streamIdleTimeoutValue: "1800" }),
  });
  assert.equal(result.status, "commit");
  if (result.status !== "commit") return;
  assert.equal(result.model.config.properties?.streamIdleTimeoutMs, 1_800_000);
  assert.equal(result.model.personalConfig.properties?.streamIdleTimeoutMs, 1_800_000);
});

test("empty timeout input drops the leaf instead of writing a zero or null override", () => {
  const result = resolveProviderModelDraftCommit({
    currentModel: createModelFixture({
      personalConfig: { properties: { streamIdleTimeoutMs: 900_000 } },
    }),
    draft: createDraftFixture({ streamIdleTimeoutValue: "" }),
  });
  assert.equal(result.status, "commit");
  if (result.status !== "commit") return;
  assert.equal(result.model.personalConfig.properties?.streamIdleTimeoutMs, undefined);
});

test("non-numeric timeout input is rejected on the streamIdleTimeout field", () => {
  const result = resolveProviderModelDraftCommit({
    currentModel: createModelFixture(),
    draft: createDraftFixture({ streamIdleTimeoutValue: "abc" }),
  });
  assert.deepEqual(result, { status: "invalid", field: "streamIdleTimeout" });
});
