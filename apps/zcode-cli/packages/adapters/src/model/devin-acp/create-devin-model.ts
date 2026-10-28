import type {
  Logger,
  McpServerConfig,
  Model,
  ModelId,
  ModelProviderId,
} from "@zcode/contracts";
import type { RegistryModelConfig, RegistryProviderConfig } from "@zcode/provider";
import { createModel, type ModelExecutor } from "../model.js";
import { DevinModelExecutor } from "./executor.js";

export interface DevinAcpAdapterDeps {
  /** 返回当前 config 的 mcp.servers；每次 session/new 时读取，保证配置热更新生效。 */
  readonly listMcpServers?: () => Readonly<Record<string, McpServerConfig>>;
  readonly logger?: Logger;
}

export interface CreateDevinAcpModelOptions {
  readonly providerId: string;
  readonly modelId: string;
  readonly providerConfig: RegistryProviderConfig;
  readonly modelConfig: RegistryModelConfig;
  readonly displayName?: string;
  readonly options?: { reasoningLevel?: string; maxOutputTokens?: number };
}

const DEFAULT_PROMPT_TIMEOUT_MS = 7_200_000;

/**
 * api.type="devin-acp" 的模型构造：对外仍是标准 ZCode Model，
 * 内部 executor 拥有 devin acp 子进程生命周期。
 * Devin 任务是长程执行，不走 AI SDK retry/idle-timeout 路径（重试会重启任务）。
 */
export function createDevinAcpModel(
  options: CreateDevinAcpModelOptions,
  deps: DevinAcpAdapterDeps = {},
): Model {
  const access = options.providerConfig.access;
  if (access.type !== "devin-acp") {
    throw new Error(
      `devin-acp provider requires devin-acp access, got: ${access.type}`,
    );
  }
  const mcpPassthrough = access.mcpPassthrough !== false;
  const executor: DevinModelExecutor = new DevinModelExecutor({
    binaryPath: access.binaryPath,
    apiKey: access.apiKey,
    modelId: options.modelId,
    mode: access.mode,
    promptTimeoutMs: access.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS,
    contextForward: access.contextForward,
    // devin acp 的 session cwd 即 agent 进程 cwd（= 当前 workspace）。
    cwd: process.cwd(),
    ...(mcpPassthrough && deps.listMcpServers
      ? { listMcpServers: deps.listMcpServers }
      : {}),
    ...(deps.logger ? { logger: deps.logger } : {}),
  });
  const modelExecutor: ModelExecutor = {
    generateText: (request) => executor.generateText(request),
    streamText: (request) => executor.streamText(request),
  };
  return createModel({
    providerId: options.providerId as ModelProviderId,
    modelId: options.modelId as ModelId,
    ...(options.displayName === undefined ? {} : { displayName: options.displayName }),
    properties: options.modelConfig.properties,
    optionSpecs: options.modelConfig.optionSpecs,
    ...(options.options === undefined ? {} : { options: options.options }),
    executor: modelExecutor,
  });
}
