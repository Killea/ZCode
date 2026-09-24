import {
  createUnsupportedModelInputMediaText,
  isProviderVisiblePdfModelInputBlock,
  isProviderVisibleVideoModelInputBlock,
  type ModelInputMessage,
  type ModelMessageContentBlock,
  type UnsupportedModelInputMediaKind,
} from "@zcode/contracts";
import { inspectProviderFailure } from "./failure-classifier.js";

/**
 * provider 明确拒绝的输入模态（按 wire content type 归并）。
 * "file" 覆盖我们的 PDF file 块与 video 块——两者在 wire 上都序列化为 file part。
 * "unknown" 表示上游只给了 modality_not_supported 而没有可读类型，按全部媒体降级。
 */
export type RejectedInputModality = "image" | "file" | "video" | "unknown";

/** 单次模型调用内最多允许的模态修复次数（image / file / unknown 各算一次）。 */
export const MAX_INPUT_MODALITY_REPAIR_ATTEMPTS = 3;

// llama.cpp/ninfer 类本地服务与部分 openai-compatible 网关拒绝某个内容类型时的消息形态。
const CONTENT_TYPE_REJECTION_PATTERN = /content type '([^']+)' is not supported/i;

/**
 * 识别「provider 拒绝某个输入模态」的失败。
 * 只读 provider 业务错误（provider_code / provider message）；本地校验抛出的
 * InvalidModelRequest（如 "Model does not support PDF input"）不在这里的识别范围——
 * 那是声明投影层该拦的，不修。
 */
export function rejectedInputModalityFromError(
  error: unknown,
): RejectedInputModality | undefined {
  const { providerErrorCode, providerErrorMessage } = inspectProviderFailure(error);
  const message =
    providerErrorMessage ?? (error instanceof Error ? error.message : undefined);
  const contentTypeMatch = message?.match(CONTENT_TYPE_REJECTION_PATTERN);
  if (providerErrorCode?.toLowerCase() !== "modality_not_supported" && !contentTypeMatch) {
    return undefined;
  }
  const wireType = contentTypeMatch?.[1]?.trim().toLowerCase();
  switch (wireType) {
    case "image":
    case "image_url":
      return "image";
    case "file":
      return "file";
    case "video":
    case "video_url":
      return "video";
    case undefined:
      // 只有 modality_not_supported、没有可读类型：按全部媒体降级。
      return "unknown";
    default:
      // text 等其余类型没有可降级的媒体形态，修了也是同样的 400。
      return undefined;
  }
}

/** 一次拒绝实际覆盖到哪些模态类别（用于「同一 kind 不重复修」的记账）。 */
export function modalitiesCoveredByRejection(
  rejected: RejectedInputModality,
): readonly RejectedInputModality[] {
  switch (rejected) {
    case "file":
      // wire 'file' part 同时承载 file(pdf) 与 video 块。
      return ["file", "video"];
    case "unknown":
      return ["image", "file", "video"];
    default:
      return [rejected];
  }
}

export interface InputModalityRepairProjection {
  messages: ModelInputMessage[];
  omittedMediaCount: number;
}

/**
 * 把请求消息副本中被拒模态的 provider-visible 媒体块替换为文本占位——
 * 与 `projectMessagesForInputFormat`（core capability 投影）同一组判定谓词和占位文案，
 * 效果等同「这个模态的声明被关掉」，但只作用于本次调用的请求副本，不改写 canonical
 * history，也不修改用户声明的能力配置。
 * 没有任何可替换的块时返回 undefined（请求里没有该模态，修复无意义）。
 */
export function projectRejectedInputModality(
  messages: readonly ModelInputMessage[],
  rejected: RejectedInputModality,
): InputModalityRepairProjection | undefined {
  let omittedMediaCount = 0;
  let changed = false;
  const projected = messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    let messageChanged = false;
    const content = message.content.map((block) => {
      const kind = rejectedModalityKindOfBlock(block, rejected);
      if (kind === undefined) return block;
      messageChanged = true;
      changed = true;
      omittedMediaCount += 1;
      return {
        type: "text" as const,
        text: createUnsupportedModelInputMediaText(block, kind),
      };
    });
    return messageChanged
      ? {
          ...message,
          cacheControl: message.cacheControl ? { ...message.cacheControl } : undefined,
          content,
          toolCalls: message.toolCalls?.map((toolCall) => ({ ...toolCall })),
        }
      : message;
  });
  return changed ? { messages: projected, omittedMediaCount } : undefined;
}

function rejectedModalityKindOfBlock(
  block: ModelMessageContentBlock,
  rejected: RejectedInputModality,
): UnsupportedModelInputMediaKind | undefined {
  switch (rejected) {
    case "image":
      return block.type === "image" ? "image input" : undefined;
    case "file":
      if (isProviderVisiblePdfModelInputBlock(block)) return "PDF input";
      if (isProviderVisibleVideoModelInputBlock(block)) return "video input";
      return undefined;
    case "video":
      return isProviderVisibleVideoModelInputBlock(block) ? "video input" : undefined;
    case "unknown":
      if (block.type === "image") return "image input";
      if (isProviderVisiblePdfModelInputBlock(block)) return "PDF input";
      if (isProviderVisibleVideoModelInputBlock(block)) return "video input";
      return undefined;
  }
}
