import {
  getCurrentModelInvocationContext,
  modelMessageContentToText,
  type ModelEvent,
  type ModelResult,
} from "@zcode/contracts";
import type { ModelExecutionRequest, ModelExecutor } from "../model.js";
import {
  DEVIN_CONTEXT_RESOURCE_URI,
  DevinAcpBridge,
  type DevinAcpBridgeOptions,
  type DevinAcpPromptPart,
  type DevinAcpUpdate,
} from "./bridge.js";
import {
  extractForwardableContext,
  flattenTranscriptForNewSession,
  type DevinContextForwardPolicy,
} from "./context-filter.js";

const DEFAULT_SESSION_KEY = "default";
const TEXT_BLOCK_ID = "devin-text";
const REASONING_BLOCK_ID = "devin-thought";

export interface DevinModelExecutorOptions extends DevinAcpBridgeOptions {
  readonly contextForward?: DevinContextForwardPolicy | null;
}

/**
 * Devin ACP 模型执行器：把 ZCode ModelRequest 翻译成 session/prompt，
 * 把 session/update 通知翻译成 ZCode 流事件。
 * ZCode 原生 tool schema 不转发（Devin 无法执行它们，prompt 注入只会诱发幻觉）。
 */
export class DevinModelExecutor implements ModelExecutor {
  private readonly bridge: DevinAcpBridge;
  private readonly contextForward: DevinContextForwardPolicy;

  constructor(options: DevinModelExecutorOptions) {
    this.bridge = new DevinAcpBridge(options);
    this.contextForward = options.contextForward ?? "memory-only";
  }

  /** 连通性测试入口：执行真实的 spawn+initialize+authenticate，不发 prompt。 */
  async probe(): Promise<{ version?: string }> {
    return this.bridge.probe();
  }

  async generateText(request: ModelExecutionRequest): Promise<ModelResult> {
    let text = "";
    let finishReason = "stop";
    let usage: ModelResult["usage"] = {};
    for await (const event of this.streamText(request)) {
      if (event.type === "text_delta") text += event.text;
      if (event.type === "finish") {
        finishReason = event.finishReason;
        usage = event.usage;
      }
    }
    return { text, finishReason, usage };
  }

  async *streamText(request: ModelExecutionRequest): AsyncGenerator<ModelEvent> {
    yield { type: "start" };
    const sessionKey =
      getCurrentModelInvocationContext()?.traceContext?.sessionId ?? DEFAULT_SESSION_KEY;
    const handle = await this.bridge.ensureSession(sessionKey);
    const parts = this.buildPromptParts(request.messages, handle.isNew);
    if (parts.length === 0) {
      yield { type: "finish", finishReason: "stop", usage: {} };
      return;
    }

    const updates = new UpdateQueue();
    let textStarted = false;
    let reasoningStarted = false;
    // Devin usage_update 可能在一轮 prompt 内多次到达（流式中途 + 结束时），
    // finish.usage 只带最后一份快照；meter 语义是"当前占用"而不是累计值。
    let latestUsage: Extract<DevinAcpUpdate, { kind: "usage" }> | undefined;
    const closeReasoning = function* (): Generator<ModelEvent> {
      if (reasoningStarted) {
        reasoningStarted = false;
        yield { type: "reasoning_end", id: REASONING_BLOCK_ID };
      }
    };

    try {
      const promptDone = this.bridge.runPrompt({
        acpSessionId: handle.acpSessionId,
        parts,
        ...(request.abortSignal ? { signal: request.abortSignal } : {}),
        onUpdate: (update) => updates.push(update),
      });
      promptDone.then(
        (result) => updates.complete(result.stopReason),
        (error: unknown) => updates.fail(error),
      );

      let stopReason = "end_turn";
      for (;;) {
        const next = await updates.next();
        if (next.done) {
          stopReason = next.stopReason;
          break;
        }
        const update = next.value;
        // usage 快照不产生文本/推理块，只暂存供 finish.usage 使用。
        if (update.kind === "usage") {
          latestUsage = update;
          continue;
        }
        if (update.kind === "thought") {
          if (!reasoningStarted) {
            reasoningStarted = true;
            yield { type: "reasoning_start", id: REASONING_BLOCK_ID };
          }
          yield { type: "reasoning_delta", id: REASONING_BLOCK_ID, text: update.text };
          continue;
        }
        yield* closeReasoning();
        if (!textStarted) {
          textStarted = true;
          yield { type: "text_start", id: TEXT_BLOCK_ID };
        }
        if (update.kind === "text") {
          yield { type: "text_delta", id: TEXT_BLOCK_ID, text: update.text };
        } else if (update.kind === "tool") {
          const status = update.status ? ` (${update.status})` : "";
          yield { type: "text_delta", id: TEXT_BLOCK_ID, text: `\n[devin tool] ${update.title}${status}\n` };
        } else if (update.kind === "plan" && update.text) {
          yield { type: "text_delta", id: TEXT_BLOCK_ID, text: update.text };
        }
      }
      yield* closeReasoning();
      if (textStarted) yield { type: "text_end", id: TEXT_BLOCK_ID };
      yield {
        type: "finish",
        finishReason: mapStopReason(stopReason),
        usage: latestUsage
          ? { contextTokens: latestUsage.used, contextWindow: latestUsage.size }
          : {},
        providerMetadata: {
          devinStopReason: stopReason,
          ...(latestUsage?.cost ? { devinCost: latestUsage.cost } : {}),
        },
      };
    } catch (error) {
      yield* closeReasoning();
      if (textStarted) yield { type: "text_end", id: TEXT_BLOCK_ID };
      throw error;
    }
  }

  /**
   * 组装 prompt parts：[上下文 resource] + [新 session 历史前缀] + [当前 user 文本]。
   * 多轮历史由 Devin ACP session 自己维护；只有 isNew（新 session/恢复失败/切模型）
   * 才把 ZCode 历史序列化为文本前缀。
   */
  private buildPromptParts(
    messages: ModelExecutionRequest["messages"],
    isNewSession: boolean,
  ): DevinAcpPromptPart[] {
    const lastUserIndex = findLastUserMessageIndex(messages);
    if (lastUserIndex < 0) return [];
    const parts: DevinAcpPromptPart[] = [];

    if (isNewSession) {
      const context = extractForwardableContext(messages, this.contextForward);
      if (context) {
        parts.push({
          type: "resource",
          resource: { uri: DEVIN_CONTEXT_RESOURCE_URI, text: context, mimeType: "text/markdown" },
        });
      }
      const history = messages.slice(0, lastUserIndex);
      if (history.length > 0) {
        parts.push({ type: "text", text: flattenTranscriptForNewSession(history) });
      }
    }

    parts.push({
      type: "text",
      text: modelMessageContentToText(messages[lastUserIndex].content),
    });
    return parts;
  }
}

function findLastUserMessageIndex(
  messages: ModelExecutionRequest["messages"],
): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "user") return index;
  }
  return -1;
}

function mapStopReason(stopReason: string): string {
  switch (stopReason) {
    case "end_turn":
      return "stop";
    case "max_tokens":
    case "max_turn_requests":
      return "length";
    case "refusal":
      return "content-filter";
    case "cancelled":
      return "cancelled";
    default:
      return "stop";
  }
}

/**
 * runPrompt 的回调式 update → async generator 拉取队列。
 * 完成时带上 stopReason；失败时让 next() 抛出原始错误。
 */
class UpdateQueue {
  private readonly queue: DevinAcpUpdate[] = [];
  private waiter?: (result: IteratorResult<DevinAcpUpdate>) => void;
  private finished = false;
  private stopReason = "end_turn";
  private error?: unknown;

  push(update: DevinAcpUpdate): void {
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = undefined;
      waiter({ value: update, done: false });
      return;
    }
    this.queue.push(update);
  }

  complete(stopReason: string): void {
    this.finished = true;
    this.stopReason = stopReason;
    this.flushWaiter();
  }

  fail(error: unknown): void {
    this.finished = true;
    this.error = error;
    this.flushWaiter();
  }

  async next(): Promise<
    | { done: true; value?: undefined; stopReason: string }
    | { done: false; value: DevinAcpUpdate }
  > {
    if (this.queue.length > 0) {
      return { done: false, value: this.queue.shift()! };
    }
    if (this.error) throw this.error;
    if (this.finished) return { done: true, stopReason: this.stopReason };
    const item = await new Promise<IteratorResult<DevinAcpUpdate>>((resolve) => {
      this.waiter = resolve;
    });
    if (item.done) {
      if (this.error) throw this.error;
      return { done: true, stopReason: this.stopReason };
    }
    return { done: false, value: item.value };
  }

  private flushWaiter(): void {
    const waiter = this.waiter;
    this.waiter = undefined;
    waiter?.({ value: undefined as never, done: true });
  }
}
