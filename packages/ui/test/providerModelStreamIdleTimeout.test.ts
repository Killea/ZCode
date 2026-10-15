import { describe, expect, it } from "vitest";
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

describe("providerModelStreamIdleTimeout", () => {
  it("streamIdleTimeoutMs is accepted by the sparse and manual model config schemas", () => {
    expect(
      modelPropertiesDataSchema.parse({ streamIdleTimeoutMs: 1_800_000 })
        .streamIdleTimeoutMs,
    ).toBe(1_800_000);
    // manualModelConfigSchema 校验的是物化后的完整手动配置，所有可编辑叶子都必须在场。
    const manual = manualModelConfigSchema.parse({
      properties: {
        contextWindow: 200_000,
        supportsJsonSchemaOutput: false,
        supportsNativeWebSearch: false,
        supportsMidConversationSystem: false,
        streamIdleTimeoutMs: 120_000,
        inputFormat: {
          supportsImage: false,
          supportsVideo: false,
          supportsPdf: false,
        },
      },
      optionSpecs: {
        reasoningLevel: { values: ["disabled", "enabled"], map: "{}" },
        maxOutputTokens: { max: 32_000 },
      },
    });
    expect(manual.properties?.streamIdleTimeoutMs).toBe(120_000);
  });

  it("draft roundtrip renders a personal timeout override in seconds", () => {
    const model = createModelFixture({
      personalConfig: { properties: { streamIdleTimeoutMs: 1_800_000 } },
    });
    expect(createProviderModelDraftValues(model).streamIdleTimeoutValue).toBe(
      "1800",
    );
  });

  it("commit stores seconds as streamIdleTimeoutMs milliseconds in the personal overlay", () => {
    const result = resolveProviderModelDraftCommit({
      currentModel: createModelFixture(),
      draft: createDraftFixture({ streamIdleTimeoutValue: "1800" }),
    });
    expect(result.status).toBe("commit");
    if (result.status !== "commit") return;
    expect(result.model.config.properties?.streamIdleTimeoutMs).toBe(1_800_000);
    expect(result.model.personalConfig.properties?.streamIdleTimeoutMs).toBe(
      1_800_000,
    );
  });

  it("empty timeout input drops the leaf instead of writing a zero or null override", () => {
    const result = resolveProviderModelDraftCommit({
      currentModel: createModelFixture({
        personalConfig: { properties: { streamIdleTimeoutMs: 900_000 } },
      }),
      draft: createDraftFixture({ streamIdleTimeoutValue: "" }),
    });
    expect(result.status).toBe("commit");
    if (result.status !== "commit") return;
    expect(
      result.model.personalConfig.properties?.streamIdleTimeoutMs,
    ).toBeUndefined();
  });

  it("non-numeric timeout input is rejected on the streamIdleTimeout field", () => {
    const result = resolveProviderModelDraftCommit({
      currentModel: createModelFixture(),
      draft: createDraftFixture({ streamIdleTimeoutValue: "abc" }),
    });
    expect(result).toEqual({ status: "invalid", field: "streamIdleTimeout" });
  });
});
