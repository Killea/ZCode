import type { Logger, McpServerConfig } from "@zcode/contracts";
import { AcpTransport } from "./transport.js";
import { resolveDevinBinary, type DevinBinaryResolution } from "./discovery.js";

export interface DevinAcpBridgeOptions {
  readonly binaryPath?: string | null;
  readonly apiKey?: string | null;
  readonly modelId?: string;
  readonly mode?: string | null;
  readonly promptTimeoutMs: number;
  readonly cwd: string;
  /** 返回当前 zcode config 的 mcp.servers；缺省或空对象表示不透传。 */
  readonly listMcpServers?: () => Readonly<Record<string, McpServerConfig>>;
  readonly logger?: Logger;
}

export type DevinAcpPromptPart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "resource";
      readonly resource: { readonly uri: string; readonly text: string; readonly mimeType?: string };
    };

export type DevinAcpUpdate =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "thought"; readonly text: string }
  | { readonly kind: "tool"; readonly title: string; readonly status?: string }
  | { readonly kind: "plan"; readonly text: string };

export interface DevinAcpSessionHandle {
  readonly acpSessionId: string;
  readonly isNew: boolean;
}

interface SessionRecord {
  acpSessionId: string;
}

const ACP_PROTOCOL_VERSION = 1;
const DEFAULT_PROMPT_TIMEOUT_MS = 7_200_000;
const INITIALIZE_TIMEOUT_MS = 30_000;
const SESSION_NEW_TIMEOUT_MS = 60_000;
const CONTEXT_RESOURCE_URI = "zcode://context";

/**
 * Devin ACP 进程与 session 生命周期的唯一所有者。
 * spawn → initialize → authenticate → session/new；session 按 ZCode sessionKey 池化。
 * 进程退出即丢弃全部 session 记录，下一次 ensureSession 重建（调用方按 isNew 决定
 * 是否需要附带上历史前缀）。
 */
export class DevinAcpBridge {
  private readonly options: DevinAcpBridgeOptions;
  private readonly logger?: Logger;
  private transport?: AcpTransport;
  private resolution?: DevinBinaryResolution;
  private starting?: Promise<void>;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly updateHandlers = new Map<string, (update: DevinAcpUpdate) => void>();

  constructor(options: DevinAcpBridgeOptions) {
    this.options = options;
    this.logger = options.logger;
  }

  /** 进程可用性探针：供连通性测试走与正式请求相同的路径。 */
  async probe(): Promise<{ version?: string }> {
    await this.ensureStarted();
    const version = this.resolution?.version;
    return version === undefined ? {} : { version };
  }

  async ensureSession(sessionKey: string): Promise<DevinAcpSessionHandle> {
    await this.ensureStarted();
    const existing = this.sessions.get(sessionKey);
    if (existing) return { acpSessionId: existing.acpSessionId, isNew: false };

    const record = await this.createSession();
    this.sessions.set(sessionKey, record);
    return { acpSessionId: record.acpSessionId, isNew: true };
  }

  async runPrompt(input: {
    readonly acpSessionId: string;
    readonly parts: readonly DevinAcpPromptPart[];
    readonly signal?: AbortSignal;
    readonly onUpdate: (update: DevinAcpUpdate) => void;
  }): Promise<{ stopReason: string }> {
    const transport = this.requireTransport();
    this.updateHandlers.set(input.acpSessionId, input.onUpdate);
    try {
      const result = await transport.request<{ stopReason?: string }>(
        "session/prompt",
        { sessionId: input.acpSessionId, prompt: input.parts },
        {
          timeoutMs: this.options.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS,
          ...(input.signal ? { signal: input.signal } : {}),
        },
      );
      return { stopReason: result?.stopReason ?? "end_turn" };
    } catch (error) {
      // 超时/中止后尽力取消 Devin 侧任务，避免后台继续执行。
      transport.notify("session/cancel", { sessionId: input.acpSessionId });
      throw error;
    } finally {
      this.updateHandlers.delete(input.acpSessionId);
    }
  }

  async dispose(): Promise<void> {
    this.sessions.clear();
    this.updateHandlers.clear();
    await this.transport?.close();
    this.transport = undefined;
  }

  private async ensureStarted(): Promise<void> {
    if (this.transport?.isRunning) return;
    this.starting ??= this.start().finally(() => {
      this.starting = undefined;
    });
    await this.starting;
  }

  private async start(): Promise<void> {
    this.resolution = await resolveDevinBinary(this.options.binaryPath);
    const args = ["acp"];
    const modelId = this.options.modelId?.trim();
    if (modelId) args.push("--model", modelId);
    const transport = new AcpTransport({
      command: this.resolution.path,
      args,
      cwd: this.options.cwd,
      logger: this.logger,
    });
    transport.onNotification((method, params) => this.onNotification(method, params));
    transport.onRequest((method, params) => this.onReverseRequest(method, params));
    transport.onExitOnce(() => {
      this.sessions.clear();
      this.transport = undefined;
      this.logger?.warn("[devin-acp] process exited; sessions dropped");
    });
    this.transport = transport;
    try {
      await transport.request("initialize", {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientInfo: { name: "zcode", title: "ZCode", version: "0" },
        // 不广告 fs/terminal/elicitation：Devin 用自己的本地工具执行，
        // 反向请求只保留 request_permission（按 access.mode 语义自动应答）。
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      }, { timeoutMs: INITIALIZE_TIMEOUT_MS });
      await this.authenticate(transport);
    } catch (error) {
      await transport.close().catch(() => undefined);
      this.transport = undefined;
      throw error;
    }
    this.logger?.info(
      `[devin-acp] started pid=${String(transport.pid)} binary=${this.resolution.path}`,
    );
  }

  private async authenticate(transport: AcpTransport): Promise<void> {
    const apiKey = this.options.apiKey?.trim();
    const params = apiKey
      ? { methodId: "devin-browser", meta: { api_key: apiKey } }
      : { methodId: "devin-browser" };
    try {
      await transport.request("authenticate", params, { timeoutMs: INITIALIZE_TIMEOUT_MS });
    } catch (error) {
      throw new Error(
        "Devin ACP 认证失败：请在 Provider 设置中检查 Devin 登录状态或 API Key。" +
          `（${error instanceof Error ? error.message : String(error)}）`,
      );
    }
  }

  private async createSession(): Promise<SessionRecord> {
    const transport = this.requireTransport();
    const result = await transport.request<{ sessionId?: string }>(
      "session/new",
      {
        cwd: this.options.cwd,
        mcpServers: this.buildMcpServers(),
      },
      { timeoutMs: SESSION_NEW_TIMEOUT_MS },
    );
    if (!result?.sessionId) throw new Error("Devin ACP session/new 未返回 sessionId");
    const record: SessionRecord = { acpSessionId: result.sessionId };
    const mode = this.options.mode?.trim();
    if (mode) {
      // mode 值以 session/new 广告的 configOptions 为准；设置失败只告警不中断。
      transport
        .request(
          "session/set_config_option",
          { sessionId: record.acpSessionId, configId: "mode", value: mode },
          { timeoutMs: SESSION_NEW_TIMEOUT_MS },
        )
        .catch((error: unknown) => {
          this.logger?.warn(`[devin-acp] set mode=${mode} failed: ${String(error)}`);
        });
    }
    return record;
  }

  private buildMcpServers(): unknown[] {
    const servers = this.options.listMcpServers?.() ?? {};
    const mapped: unknown[] = [];
    for (const [name, config] of Object.entries(servers)) {
      if (config.enabled === false) continue;
      // zcode_official 鉴权依赖宿主逐请求注入凭证，Devin 独立 spawn 后凭证不存在；
      // 跳过并告警，避免静默把不可用的 server 传给 Devin。
      if ("auth" in config && config.auth || "official" in config && config.official) {
        this.logger?.warn(`[devin-acp] skipping mcp server with host-managed auth: ${name}`);
        continue;
      }
      if (config.type === "stdio") {
        mapped.push({
          name,
          command: config.command,
          args: config.args ?? [],
          env: Object.entries(config.env ?? {}).map(([envName, value]) => ({
            name: envName,
            value,
          })),
        });
      } else {
        mapped.push({
          name,
          type: config.type,
          url: config.url,
          headers: Object.entries(config.headers ?? {}).map(([headerName, value]) => ({
            name: headerName,
            value,
          })),
        });
      }
    }
    return mapped;
  }

  private onNotification(method: string, params: unknown): void {
    if (method !== "session/update") return;
    const notification = params as {
      sessionId?: string;
      update?: { sessionUpdate?: string; [key: string]: unknown };
    };
    const handler = notification.sessionId
      ? this.updateHandlers.get(notification.sessionId)
      : undefined;
    const update = normalizeSessionUpdate(notification.update);
    if (handler && update) handler(update);
  }

  private async onReverseRequest(
    method: string,
    params: unknown,
  ): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
    if (method === "session/request_permission") {
      return { result: resolvePermissionOutcome(params) };
    }
    return { error: { code: -32601, message: `zcode devin-acp bridge does not handle: ${method}` } };
  }

  private requireTransport(): AcpTransport {
    if (!this.transport?.isRunning) {
      throw new Error("Devin ACP process is not running");
    }
    return this.transport;
  }
}

function normalizeSessionUpdate(update: unknown): DevinAcpUpdate | undefined {
  if (typeof update !== "object" || update === null) return undefined;
  const record = update as Record<string, unknown>;
  const kind = record.sessionUpdate;
  if (kind === "agent_message_chunk") {
    const text = contentText(record.content);
    return text === undefined ? undefined : { kind: "text", text };
  }
  if (kind === "agent_thought_chunk") {
    const text = contentText(record.content);
    return text === undefined ? undefined : { kind: "thought", text };
  }
  if (kind === "tool_call" || kind === "tool_call_update") {
    const title = typeof record.title === "string" ? record.title : "tool";
    const status = typeof record.status === "string" ? record.status : undefined;
    return { kind: "tool", title, ...(status === undefined ? {} : { status }) };
  }
  if (kind === "plan") {
    return { kind: "plan", text: formatPlan(record.entries) };
  }
  return undefined;
}

function contentText(content: unknown): string | undefined {
  if (typeof content !== "object" || content === null) return undefined;
  const block = content as { type?: string; text?: string };
  return block.type === "text" && typeof block.text === "string" ? block.text : undefined;
}

function formatPlan(entries: unknown): string {
  if (!Array.isArray(entries)) return "";
  const lines = entries.map((entry) => {
    const item = entry as { content?: string; status?: string; priority?: string };
    const status = item.status ? `[${item.status}] ` : "";
    return `${status}${item.content ?? ""}`;
  });
  return `\n[plan]\n${lines.join("\n")}\n`;
}

/**
 * request_permission 自动应答：权限策略由 Devin CLI 自身 mode 控制（用户决策），
 * 这里只兜底保证 ACP 反向请求不悬挂。优先选 allow 类选项，否则 cancel。
 */
function resolvePermissionOutcome(params: unknown): unknown {
  const request = params as {
    options?: Array<{ optionId?: string; kind?: string }>;
  };
  const options = request.options ?? [];
  const allow = options.find((option) => option.kind?.startsWith("allow"));
  if (allow?.optionId) {
    return { outcome: { outcome: "selected", optionId: allow.optionId } };
  }
  return { outcome: { outcome: "cancelled" } };
}

export const DEVIN_CONTEXT_RESOURCE_URI = CONTEXT_RESOURCE_URI;
