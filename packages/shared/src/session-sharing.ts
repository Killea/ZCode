import { z } from "zod";

/**
 * 局域网会话共享 wire protocol v1。
 *
 * 这里只定义跨进程/跨机器边界的 envelope 与稳定字段。session/message/part 的
 * 业务 data 仍由 CLI contracts 在导入端校验，避免 @zcode/shared 反向依赖 zcode-cli。
 */

export const SESSION_SHARING_SCHEMA_VERSION = 1 as const;
export const SESSION_SHARING_DEFAULT_IDLE_STOP_MS = 30 * 60_000;
export const SESSION_SHARING_MAX_LOG_ENTRIES = 200;
export const SESSION_SHARING_MAX_SESSIONS_PER_PAGE = 100;
export const SESSION_SHARING_MAX_PREVIEW_MESSAGES = 50;

const schemaVersionSchema = z.literal(SESSION_SHARING_SCHEMA_VERSION);
const nonEmptyStringSchema = z.string().trim().min(1);
const timestampSchema = z.number().int().nonnegative();
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const sessionIdSchema = z.string().trim().min(1).max(200);
const artifactIdSchema = z.string().trim().min(1).max(200);

/** 连接码去掉易混淆字符（I/O/0/1），显示时带 4-4 分隔。 */
export const sessionSharingCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/u));

/** 接受 "a7k2-9qmx"、"A7K29QMX" 等输入，统一成 "A7K2-9QMX"。 */
export function normalizeSessionSharingCode(value: string): string {
  const compact = value.replace(/[\s-]+/gu, "").toUpperCase();
  return compact.length === 8
    ? `${compact.slice(0, 4)}-${compact.slice(4)}`
    : value.trim().toUpperCase();
}

/**
 * UI 的一次性连接信息。连接码放在 fragment 里，不会随 HTTP 请求发送给服务端，
 * 也避免把凭据放进 URL query / 访问日志。
 */
export function buildSessionSharingConnectionUrl(input: {
  address: string;
  port: number;
  code: string;
}): string {
  const code = normalizeSessionSharingCode(input.code);
  return `http://${input.address}:${input.port}/#code=${encodeURIComponent(code)}`;
}

export function parseSessionSharingConnectionUrl(
  value: string,
): { baseUrl: string; code: string } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const hashParams = new URLSearchParams(url.hash.replace(/^#/u, ""));
  const rawCode = hashParams.get("code") ?? url.searchParams.get("code") ?? "";
  const code = normalizeSessionSharingCode(rawCode);
  if (!sessionSharingCodeSchema.safeParse(code).success) return null;
  return { baseUrl: url.origin, code };
}

export function isSessionSharingSchemaVersionSupported(version: number): boolean {
  return Number.isInteger(version) && version >= 1 && version <= SESSION_SHARING_SCHEMA_VERSION;
}

export const sessionSharingErrorCodeSchema = z.enum([
  "invalid_request",
  "unauthorized",
  "lan_only",
  "session_not_found",
  "session_busy",
  "session_conflict",
  "payload_too_large",
  "pair_code_invalid",
  "pair_rate_limited",
  "pair_locked",
  "unsupported_version",
  "internal",
]);
export type SessionSharingErrorCode = z.infer<typeof sessionSharingErrorCodeSchema>;

export const sessionSharingErrorResponseSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    error: z
      .object({
        code: sessionSharingErrorCodeSchema,
        message: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();
export type SessionSharingErrorResponse = z.infer<typeof sessionSharingErrorResponseSchema>;

export const sessionSharingClientPlatformSchema = z.enum(["darwin", "linux", "win32", "other"]);
export type SessionSharingClientPlatform = z.infer<typeof sessionSharingClientPlatformSchema>;

export const sessionSharingClientInfoSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    platform: sessionSharingClientPlatformSchema,
    appVersion: z.string().trim().min(1).max(80),
  })
  .strict();
export type SessionSharingClientInfo = z.infer<typeof sessionSharingClientInfoSchema>;

export const sessionSharingPairRequestSchema = z
  .object({
    code: sessionSharingCodeSchema,
    client: sessionSharingClientInfoSchema,
  })
  .strict();
export type SessionSharingPairRequest = z.infer<typeof sessionSharingPairRequestSchema>;

export const sessionSharingPairResponseSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    token: z.string().min(32),
    expiresAt: timestampSchema,
  })
  .strict();
export type SessionSharingPairResponse = z.infer<typeof sessionSharingPairResponseSchema>;

export const sessionSharingSessionStatusSchema = z.enum(["idle", "running"]);
export type SessionSharingSessionStatus = z.infer<typeof sessionSharingSessionStatusSchema>;

export const sessionSharingSessionSummarySchema = z
  .object({
    id: sessionIdSchema,
    title: z.string(),
    workspacePath: z.string(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    messageCount: z.number().int().nonnegative(),
    partCount: z.number().int().nonnegative(),
    status: sessionSharingSessionStatusSchema,
    sizeBytes: z.number().int().nonnegative(),
    artifactCount: z.number().int().nonnegative(),
    taskType: z.string(),
    parentID: sessionIdSchema.nullable(),
  })
  .strict();
export type SessionSharingSessionSummary = z.infer<typeof sessionSharingSessionSummarySchema>;

export const sessionSharingListSessionsResponseSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    sessions: z.array(sessionSharingSessionSummarySchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type SessionSharingListSessionsResponse = z.infer<
  typeof sessionSharingListSessionsResponseSchema
>;

export const sessionSharingWorkspaceManifestSchema = z
  .object({
    path: z.string(),
    gitHead: z.string().nullable(),
    gitDirty: z.boolean().nullable(),
    platform: z.string(),
  })
  .strict();
export type SessionSharingWorkspaceManifest = z.infer<typeof sessionSharingWorkspaceManifestSchema>;

export const sessionSharingSourceInfoSchema = z
  .object({
    /** 稳定设备 ID，用于目标端生成确定性 session ID 和 provenance。 */
    deviceId: z.string().trim().min(1).max(200),
    deviceName: z.string().trim().min(1).max(80),
    appVersion: z.string().trim().min(1).max(80),
    exportedAt: timestampSchema,
  })
  .strict();
export type SessionSharingSourceInfo = z.infer<typeof sessionSharingSourceInfoSchema>;

export const sessionSharingArtifactDescriptorSchema = z
  .object({
    artifactId: artifactIdSchema,
    mime: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    sha256: sha256Schema,
  })
  .strict();
export type SessionSharingArtifactDescriptor = z.infer<
  typeof sessionSharingArtifactDescriptorSchema
>;

export const sessionSharingSessionManifestSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    session: z
      .object({
        id: sessionIdSchema,
        title: z.string(),
        directory: z.string(),
      })
      .strict(),
    workspace: sessionSharingWorkspaceManifestSchema,
    source: sessionSharingSourceInfoSchema,
    counts: z
      .object({
        messages: z.number().int().nonnegative(),
        parts: z.number().int().nonnegative(),
        entries: z.number().int().nonnegative(),
        todos: z.number().int().nonnegative(),
      })
      .strict(),
    artifacts: z.array(sessionSharingArtifactDescriptorSchema),
  })
  .strict();
export type SessionSharingSessionManifest = z.infer<typeof sessionSharingSessionManifestSchema>;

export const sessionSharingPreviewMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    text: z.string(),
  })
  .strict();
export type SessionSharingPreviewMessage = z.infer<typeof sessionSharingPreviewMessageSchema>;

export const sessionSharingPreviewResponseSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    messages: z.array(sessionSharingPreviewMessageSchema),
    truncated: z.boolean(),
  })
  .strict();
export type SessionSharingPreviewResponse = z.infer<typeof sessionSharingPreviewResponseSchema>;

/**
 * 导出流的 envelope。session/message/part/entry/todo 的 data 刻意保持 unknown：
 * 这些结构的权威 schema 在 CLI contracts，导入端必须再用 CLI 的校验器复核，
 * 不能在 shared 里复制一份会漂移的业务 schema。
 */
export const sessionSharingExportRecordSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manifest"), data: sessionSharingSessionManifestSchema }).strict(),
  z.object({ kind: z.literal("session"), data: z.unknown() }).strict(),
  z.object({ kind: z.literal("message"), data: z.unknown() }).strict(),
  z.object({ kind: z.literal("part"), data: z.unknown() }).strict(),
  z.object({ kind: z.literal("entry"), data: z.unknown() }).strict(),
  z.object({ kind: z.literal("todo"), data: z.unknown() }).strict(),
  z.object({ kind: z.literal("artifact"), data: sessionSharingArtifactDescriptorSchema }).strict(),
]);
export type SessionSharingExportRecord = z.infer<typeof sessionSharingExportRecordSchema>;

export const sessionSharingServiceStateSchema = z.enum([
  "off",
  "starting",
  "running",
  "stopping",
  "error",
]);
export type SessionSharingServiceState = z.infer<typeof sessionSharingServiceStateSchema>;

export const sessionSharingPeerSchema = z
  .object({
    id: nonEmptyStringSchema,
    name: z.string().trim().min(1).max(80),
    platform: sessionSharingClientPlatformSchema,
    appVersion: z.string().trim().min(1).max(80),
    address: z.string(),
    connectedAt: timestampSchema,
    lastSeenAt: timestampSchema,
  })
  .strict();
export type SessionSharingPeer = z.infer<typeof sessionSharingPeerSchema>;

export const sessionSharingLogKindSchema = z.enum([
  "service_started",
  "service_stopped",
  "pair_succeeded",
  "pair_failed",
  "peer_disconnected",
  "session_exported",
  "session_export_rejected",
  "artifact_failed",
  "error",
]);
export type SessionSharingLogKind = z.infer<typeof sessionSharingLogKindSchema>;

export const sessionSharingLogEntrySchema = z
  .object({
    id: nonEmptyStringSchema,
    at: timestampSchema,
    kind: sessionSharingLogKindSchema,
    peer: sessionSharingPeerSchema.nullable(),
    sessionId: sessionIdSchema.nullable(),
    sessionTitle: z.string().nullable(),
    bytes: z.number().int().nonnegative().nullable(),
    errorCode: sessionSharingErrorCodeSchema.nullable(),
    message: z.string().nullable(),
  })
  .strict();
export type SessionSharingLogEntry = z.infer<typeof sessionSharingLogEntrySchema>;

export const sessionSharingStatusSchema = z
  .object({
    state: sessionSharingServiceStateSchema,
    address: z.string().nullable(),
    port: z.number().int().min(1).max(65535).nullable(),
    code: z.string().nullable(),
    startedAt: timestampSchema.nullable(),
    idleStopAt: timestampSchema.nullable(),
    peers: z.array(sessionSharingPeerSchema),
    lastEvent: sessionSharingLogEntrySchema.nullable(),
    error: z.string().nullable(),
  })
  .strict();
export type SessionSharingStatus = z.infer<typeof sessionSharingStatusSchema>;

export const sessionSharingStartRequestSchema = z
  .object({
    /** 省略时由服务选择主私有 IPv4。 */
    address: z.string().trim().min(1).optional(),
    idleStopMs: z
      .number()
      .int()
      .positive()
      .max(24 * 60 * 60_000)
      .optional(),
  })
  .strict();
export type SessionSharingStartRequest = z.infer<typeof sessionSharingStartRequestSchema>;

export const sessionSharingDisconnectPeerRequestSchema = z
  .object({
    peerId: nonEmptyStringSchema,
  })
  .strict();
export type SessionSharingDisconnectPeerRequest = z.infer<
  typeof sessionSharingDisconnectPeerRequestSchema
>;

export const sessionSharingConnectPeerRequestSchema = z
  .object({
    baseUrl: z.string().url(),
    code: sessionSharingCodeSchema,
    client: sessionSharingClientInfoSchema,
  })
  .strict();
export type SessionSharingConnectPeerRequest = z.infer<
  typeof sessionSharingConnectPeerRequestSchema
>;

export const sessionSharingPeerRefSchema = z
  .object({
    peerId: nonEmptyStringSchema,
    baseUrl: z.string().url(),
    deviceName: z.string().trim().min(1).max(80),
  })
  .strict();
export type SessionSharingPeerRef = z.infer<typeof sessionSharingPeerRefSchema>;

export const sessionSharingConnectPeerResponseSchema = z
  .object({
    peer: sessionSharingPeerRefSchema,
    sessions: z.array(sessionSharingSessionSummarySchema),
  })
  .strict();
export type SessionSharingConnectPeerResponse = z.infer<
  typeof sessionSharingConnectPeerResponseSchema
>;

export const sessionSharingListPeerSessionsRequestSchema = z
  .object({
    peerId: nonEmptyStringSchema,
    query: z.string().optional(),
    limit: z.number().int().positive().max(SESSION_SHARING_MAX_SESSIONS_PER_PAGE).optional(),
    cursor: z.string().nullable().optional(),
  })
  .strict();
export type SessionSharingListPeerSessionsRequest = z.infer<
  typeof sessionSharingListPeerSessionsRequestSchema
>;

export const sessionSharingPreviewPeerSessionRequestSchema = z
  .object({
    peerId: nonEmptyStringSchema,
    sessionId: sessionIdSchema,
    limit: z.number().int().positive().max(SESSION_SHARING_MAX_PREVIEW_MESSAGES).optional(),
  })
  .strict();
export type SessionSharingPreviewPeerSessionRequest = z.infer<
  typeof sessionSharingPreviewPeerSessionRequestSchema
>;

export const sessionSharingImportPeerSessionRequestSchema = z
  .object({
    peerId: nonEmptyStringSchema,
    sessionId: sessionIdSchema,
    workspacePath: nonEmptyStringSchema,
    workspaceIdentity: z.string().trim().min(1).optional(),
    modelSelection: z.unknown().optional(),
  })
  .strict();
export type SessionSharingImportPeerSessionRequest = z.infer<
  typeof sessionSharingImportPeerSessionRequestSchema
>;

export const sessionSharingImportPeerSessionResponseSchema = z
  .object({
    sessionId: sessionIdSchema,
    title: z.string(),
    workspacePath: z.string(),
    /** 同一源设备/源 session 已经导入过时为 true，此时直接打开已有会话。 */
    reused: z.boolean(),
    importedMessages: z.number().int().nonnegative(),
    importedParts: z.number().int().nonnegative(),
    importedArtifacts: z.number().int().nonnegative(),
    skippedAttachments: z.number().int().nonnegative(),
    warnings: z.array(z.string()),
  })
  .strict();
export type SessionSharingImportPeerSessionResponse = z.infer<
  typeof sessionSharingImportPeerSessionResponseSchema
>;

export const sessionSharingClosePeerRequestSchema = z
  .object({
    peerId: nonEmptyStringSchema,
  })
  .strict();
export type SessionSharingClosePeerRequest = z.infer<typeof sessionSharingClosePeerRequestSchema>;
