import assert from "node:assert/strict";
import test from "node:test";
import type { ModelInputMessage, ModelMessageContentBlock } from "@zcode/contracts";
import { createModelId, createModelProviderId } from "@zcode/contracts";
import {
  MAX_INPUT_MODALITY_REPAIR_ATTEMPTS,
  modalitiesCoveredByRejection,
  projectRejectedInputModality,
  rejectedInputModalityFromError,
} from "../src/model/modality-rejection-repair.js";
import { ProviderBusinessError } from "../src/model/model-execution.js";
import { runGenerateText } from "../src/model/runner-generate.js";
import type { AiSdkModelRuntime, ResolvedAiSdkModel } from "../src/model/runner-runtime.js";

// 模态能力是声明式的：自托管 openai-compatible 端点（如本地推理服务）声明
// supportsPdf/supportsImage 后，provider 仍可能在请求时拒绝该内容类型
// （`content type 'file' is not supported` / modality_not_supported）。
// 这些测试锁住「provider 明确拒绝 → 请求副本降级为文本占位 → 不占预算重发一次」的契约。

const PDF_BLOCK = {
  type: "file" as const,
  mediaType: "application/pdf",
  name: "receipt.pdf",
  dataUrl: "data:application/pdf;base64,JVBERi0x",
};
const VIDEO_BLOCK = {
  type: "video" as const,
  mediaType: "video/mp4",
  dataUrl: "data:video/mp4;base64,AAAA",
};
const IMAGE_BLOCK = {
  type: "image" as const,
  mediaType: "image/png",
  dataUrl: "data:image/png;base64,iVBOR",
};

function modalityError(input: { providerCode?: string; message: string }): ProviderBusinessError {
  return new ProviderBusinessError({
    providerCode: input.providerCode,
    providerId: "local",
    providerKind: "openai-compatible",
    providerMessage: input.message,
    statusCode: 400,
  });
}

function userMessage(...content: ModelMessageContentBlock[]): ModelInputMessage {
  return { role: "user", content };
}

test("modality rejection detection: provider code and content-type message", () => {
  assert.equal(
    rejectedInputModalityFromError(
      modalityError({
        providerCode: "modality_not_supported",
        message: "content type 'file' is not supported",
      }),
    ),
    "file",
  );
  // 无结构化 code 时按消息模式识别（部分网关只回文本）。
  assert.equal(
    rejectedInputModalityFromError(
      modalityError({ message: "content type 'image_url' is not supported" }),
    ),
    "image",
  );
  // 只有 code、没有可读类型 → unknown（一次性全部降级）。
  assert.equal(
    rejectedInputModalityFromError(
      modalityError({ providerCode: "modality_not_supported", message: "unsupported modality" }),
    ),
    "unknown",
  );
});

test("modality rejection detection: unrelated failures are not repaired", () => {
  assert.equal(
    rejectedInputModalityFromError(
      modalityError({ providerCode: "1234", message: "rate limited" }),
    ),
    undefined,
  );
  // 'text' 没有可降级的媒体形态，修了也是同样的 400。
  assert.equal(
    rejectedInputModalityFromError(
      modalityError({ message: "content type 'text' is not supported" }),
    ),
    undefined,
  );
  assert.equal(rejectedInputModalityFromError(new Error("socket hangup")), undefined);
});

test("file rejection covers pdf file blocks and video blocks (same wire part)", () => {
  assert.deepEqual(modalitiesCoveredByRejection("file"), ["file", "video"]);
  assert.deepEqual(modalitiesCoveredByRejection("unknown"), ["image", "file", "video"]);
});

test("projection replaces rejected modality blocks with text placeholders only", () => {
  const messages: ModelInputMessage[] = [
    userMessage({ type: "text", text: "look" }, PDF_BLOCK, VIDEO_BLOCK, IMAGE_BLOCK),
  ];
  const projection = projectRejectedInputModality(messages, "file");
  assert.ok(projection);
  assert.equal(projection.omittedMediaCount, 2);
  const content = projection.messages[0]?.content;
  assert.ok(Array.isArray(content));
  assert.deepEqual(
    content.map((block) => block.type),
    ["text", "text", "text", "image"],
  );
  const textOf = (index: number): string => {
    const block = content[index];
    return block && "text" in block ? String(block.text) : "";
  };
  assert.match(textOf(1), /Media omitted/);
  assert.match(textOf(1), /receipt\.pdf/);
  // 原消息不被改写（canonical history 不可变）。
  assert.equal((messages[0]?.content as unknown[])[1], PDF_BLOCK);
});

test("projection returns undefined when no matching media exists", () => {
  const messages: ModelInputMessage[] = [userMessage({ type: "text", text: "hi" }, IMAGE_BLOCK)];
  assert.equal(projectRejectedInputModality(messages, "file"), undefined);
});

function fakeResolved(): ResolvedAiSdkModel {
  return {
    providerId: createModelProviderId("local"),
    modelId: createModelId("test-model"),
    providerKind: "openai-compatible",
    // 声明支持 PDF（错误声明），投影保留 file 块 → provider 才拒绝。
    properties: {
      requiresMfjsToolSchema: false,
      contextWindow: 128_000,
      inputFormat: {
        supportsText: true,
        supportsImage: true,
        supportsVideo: true,
        supportsAudio: true,
        supportsPdf: true,
      },
      outputFormat: { supportsText: true },
      supportsToolCall: true,
      supportsJsonSchemaOutput: false,
      supportsNativeWebSearch: false,
      supportsMidConversationSystem: true,
    },
    model: {} as ResolvedAiSdkModel["model"],
  };
}

const RETRY = { maxAttempts: 1, baseDelayMs: 1, backoffFactor: 1, maxDelayMs: 1, jitter: false };

function fakeResult() {
  return {
    finishReason: "stop",
    text: "done",
    providerMetadata: undefined,
    reasoning: undefined,
    totalUsage: { inputTokens: 1, outputTokens: 1 },
    usage: { inputTokens: 1, outputTokens: 1 },
  };
}

function partTypes(options: { messages?: unknown }): string[] {
  const messages = options.messages as { content?: unknown }[] | undefined;
  const parts = (messages?.[0]?.content ?? []) as { type: string }[];
  return parts.map((part) => part.type);
}

test("generate path retries once with file media downgraded to text", async () => {
  const calls: { messages?: unknown }[] = [];
  const runtime: AiSdkModelRuntime = {
    async generateText(options) {
      calls.push(options);
      if (calls.length === 1) {
        throw modalityError({
          providerCode: "modality_not_supported",
          message: "content type 'file' is not supported",
        });
      }
      return fakeResult() as never;
    },
    streamText() {
      throw new Error("unused");
    },
  };

  const result = await runGenerateText({
    env: {},
    request: {
      messages: [userMessage({ type: "text", text: "summarize" }, PDF_BLOCK)],
    },
    resolveModel: fakeResolved,
    resolved: fakeResolved(),
    retry: RETRY,
    runtime,
    modelIoFullRetentionEnabled: false,
  });

  assert.equal(result.text, "done");
  assert.equal(calls.length, 2);
  // 第一次请求带着 file part；第二次请求该块已被文本占位替换。
  assert.ok(partTypes(calls[0] ?? {}).includes("file"));
  assert.deepEqual(partTypes(calls[1] ?? {}), ["text", "text"]);
  const secondParts = (calls[1]?.messages as { content?: { text?: string }[] }[])[0]?.content;
  assert.match(secondParts?.[1]?.text ?? "", /Media omitted/);
});

test("generate path does not repair the same modality twice", async () => {
  const calls: unknown[] = [];
  const runtime: AiSdkModelRuntime = {
    async generateText(options) {
      calls.push(options);
      throw modalityError({
        providerCode: "modality_not_supported",
        message: "content type 'file' is not supported",
      });
    },
    streamText() {
      throw new Error("unused");
    },
  };

  await assert.rejects(
    runGenerateText({
      env: {},
      request: {
        messages: [userMessage({ type: "text", text: "summarize" }, PDF_BLOCK)],
      },
      resolveModel: fakeResolved,
      resolved: fakeResolved(),
      retry: RETRY,
      runtime,
      modelIoFullRetentionEnabled: false,
    }),
  );
  // 首请求 + 一次修复重试；同一 kind 拒绝后不再循环。
  assert.equal(calls.length, 2);
});

test("generate path leaves requests without rejected media untouched", async () => {
  const calls: unknown[] = [];
  const runtime: AiSdkModelRuntime = {
    async generateText(options) {
      calls.push(options);
      throw modalityError({
        providerCode: "modality_not_supported",
        message: "content type 'file' is not supported",
      });
    },
    streamText() {
      throw new Error("unused");
    },
  };

  await assert.rejects(
    runGenerateText({
      env: {},
      request: { messages: [userMessage({ type: "text", text: "hi" })] },
      resolveModel: fakeResolved,
      resolved: fakeResolved(),
      retry: RETRY,
      runtime,
      modelIoFullRetentionEnabled: false,
    }),
  );
  // 请求里没有可降级的媒体 → 修复无意义，按原错误抛出。
  assert.equal(calls.length, 1);
});

test("repair cap stays bounded even across different modalities", () => {
  assert.ok(MAX_INPUT_MODALITY_REPAIR_ATTEMPTS >= 1);
  assert.ok(MAX_INPUT_MODALITY_REPAIR_ATTEMPTS <= 3);
});
