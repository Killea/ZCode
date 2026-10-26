/* eslint-disable max-lines -- session sharing service is the single state owner for LAN pairing, token/peer lifecycle, HTTP export and CLI cleanup; splitting would duplicate accepted state. */
import { randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fetch } from "undici";
import type {
  SessionSharingClientInfo,
  SessionSharingClosePeerRequest,
  SessionSharingConnectPeerRequest,
  SessionSharingConnectPeerResponse,
  SessionSharingDisconnectPeerRequest,
  SessionSharingErrorCode,
  SessionSharingImportPeerSessionRequest,
  SessionSharingImportPeerSessionResponse,
  SessionSharingListPeerSessionsRequest,
  SessionSharingListSessionsResponse,
  SessionSharingLogEntry,
  SessionSharingLogKind,
  SessionSharingPairResponse,
  SessionSharingPeer,
  SessionSharingPreviewPeerSessionRequest,
  SessionSharingPreviewResponse,
  SessionSharingServiceState,
  SessionSharingSessionManifest,
  SessionSharingStartRequest,
  SessionSharingStatus,
} from "@zcode/shared";
import {
  SESSION_SHARING_MAX_LOG_ENTRIES,
  isSessionSharingSchemaVersionSupported,
  normalizeSessionSharingCode,
  sessionSharingClosePeerRequestSchema,
  sessionSharingConnectPeerRequestSchema,
  sessionSharingDisconnectPeerRequestSchema,
  sessionSharingImportPeerSessionRequestSchema,
  sessionSharingImportPeerSessionResponseSchema,
  sessionSharingListPeerSessionsRequestSchema,
  sessionSharingListSessionsResponseSchema,
  sessionSharingPairRequestSchema,
  sessionSharingPairResponseSchema,
  sessionSharingPreviewPeerSessionRequestSchema,
  sessionSharingPreviewResponseSchema,
  sessionSharingSessionManifestSchema,
  sessionSharingStartRequestSchema,
} from "@zcode/shared";
import {
  isPrivateOrLoopbackAddress,
  listPrivateIpv4Addresses,
  normalizeRemoteAddress,
} from "./privateAddress.js";
import {
  SessionShareCliError,
  runSessionShareCli,
  resolveSessionShareCliPath,
  type SessionShareCliResult,
} from "./sessionShareCli.js";

const DEFAULT_IDLE_STOP_MS = 30 * 60_000;
const TOKEN_TTL_MS = 30 * 60_000;
const EXPORT_CACHE_TTL_MS = 10 * 60_000;
const EXPORT_CACHE_LIMIT = 5;
const LIST_CACHE_TTL_MS = 3_000;
const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_PREVIEW_TEXT_CHARS = 4_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

interface SessionSharingLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface SessionSharingServiceDependencies {
  appVersion: string;
  deviceId: string;
  deviceName: string;
  logger: SessionSharingLogger;
  idleStopMs?: number;
  now?: () => number;
  runCli?: (args: string[], cwd: string, timeoutMs?: number) => Promise<SessionShareCliResult>;
  /** 测试注入；生产使用本机私有 IPv4 枚举。 */
  resolveAddresses?: () => Array<{ address: string; interfaceName: string }>;
}

interface SessionShareBundleMessage {
  info: {
    role: "user" | "assistant";
    time?: { created?: number; completed?: number };
  };
  parts: Array<{ type: string; text?: string }>;
}

interface SessionShareBundle {
  schemaVersion: number;
  exportedAt: number;
  source: {
    deviceId: string;
    deviceName: string;
    appVersion: string;
    exportedAt: number;
    workspacePath: string;
    gitHead: string | null;
    gitDirty: boolean | null;
    platform: string;
  };
  snapshot: {
    session: { id: string; title: string; directory: string };
    messages: SessionShareBundleMessage[];
    entries: unknown[];
    todos: unknown[];
    artifactUris: string[];
    droppedEntryCount: number;
  };
  artifacts: Array<{
    artifactId: string;
    mime: string;
    sizeBytes: number;
    sha256: string;
    file: string;
  }>;
}

interface SessionShareCliExportResult {
  ok?: boolean;
  bundlePath?: string;
  sessionId?: string;
  title?: string;
  messageCount?: number;
  partCount?: number;
  artifactCount?: number;
  sizeBytes?: number;
  error?: string;
}

interface ExportCacheEntry {
  dir: string;
  bundlePath: string;
  bundle: SessionShareBundle;
  result: SessionShareCliExportResult;
  at: number;
}

interface PeerConnection {
  peerId: string;
  baseUrl: string;
  token: string;
  deviceName: string;
  expiresAt: number;
}

interface TokenEntry {
  peer: SessionSharingPeer;
  expiresAt: number;
}

class SessionSharingHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: SessionSharingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SessionSharingHttpError";
  }
}

export class SessionSharingService {
  private state: SessionSharingServiceState = "off";
  private server: Server | null = null;
  private address: string | null = null;
  private port: number | null = null;
  private code: string | null = null;
  private startedAt: number | null = null;
  private lastActivityAt = 0;
  private idleStopMs: number;
  private idleTimer: NodeJS.Timeout | null = null;
  private error: string | null = null;
  private tokens = new Map<string, TokenEntry>();
  private rateLimits = new Map<
    string,
    { attempts: number; windowStart: number; lockedUntil: number }
  >();
  private logs: SessionSharingLogEntry[] = [];
  private listeners = new Set<(status: SessionSharingStatus) => void>();
  private cacheDir: string | null = null;
  private exportCache = new Map<string, ExportCacheEntry>();
  private exportInFlight = new Map<string, Promise<ExportCacheEntry>>();
  private listCache: { at: number; result: SessionSharingListSessionsResponse } | null = null;
  private peerConnections = new Map<string, PeerConnection>();
  private readonly now: () => number;
  private readonly runCli: NonNullable<SessionSharingServiceDependencies["runCli"]>;

  constructor(private readonly dependencies: SessionSharingServiceDependencies) {
    this.idleStopMs = dependencies.idleStopMs ?? DEFAULT_IDLE_STOP_MS;
    this.now = dependencies.now ?? Date.now;
    this.runCli = dependencies.runCli ?? runSessionShareCli;
  }

  onStatusChanged(listener: (status: SessionSharingStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getLogs(): SessionSharingLogEntry[] {
    return [...this.logs];
  }

  getStatus(): SessionSharingStatus {
    return {
      state: this.state,
      address: this.address,
      port: this.port,
      code: this.code,
      startedAt: this.startedAt,
      idleStopAt:
        this.state === "running" && this.idleStopMs > 0
          ? this.lastActivityAt + this.idleStopMs
          : null,
      peers: this.uniquePeers(),
      lastEvent: this.logs.at(-1) ?? null,
      error: this.error,
    };
  }

  async start(options?: SessionSharingStartRequest): Promise<SessionSharingStatus> {
    if (this.state === "running") return this.getStatus();
    if (this.state === "starting" || this.state === "stopping") {
      throw new Error("Session sharing service is transitioning");
    }
    const request = sessionSharingStartRequestSchema.parse(options ?? {});
    if (!this.dependencies.runCli) {
      // 生产路径必须先确认随包 CLI 可执行；否则服务会显示 running，但首个列表/导出请求才失败。
      try {
        resolveSessionShareCliPath();
      } catch (error) {
        throw new Error(`Session sharing CLI is unavailable: ${errorMessage(error)}`);
      }
    }
    const addresses = (this.dependencies.resolveAddresses ?? listPrivateIpv4Addresses)();
    const address = request.address ?? addresses[0]?.address;
    if (!address || !addresses.some((candidate) => candidate.address === address)) {
      throw new Error("No private LAN IPv4 address is available");
    }
    this.state = "starting";
    this.error = null;
    this.address = address;
    this.port = null;
    this.code = null;
    this.startedAt = null;
    this.emitStatus();
    try {
      this.cacheDir = await mkdtemp(join(tmpdir(), "zcode-session-share-"));
      const server = createServer((req, res) => {
        void this.handleRequest(req, res);
      });
      await new Promise<void>((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(0, address, () => resolveListen());
      });
      const port = (server.address() as AddressInfo).port;
      this.server = server;
      this.port = port;
      this.code = generateConnectionCode();
      this.startedAt = this.now();
      this.lastActivityAt = this.startedAt;
      this.state = "running";
      this.startIdleTimer();
      this.log({
        kind: "service_started",
        message: `${address}:${port}`,
      });
      return this.getStatus();
    } catch (error) {
      await this.cleanup();
      this.state = "error";
      this.error = errorMessage(error);
      this.log({ kind: "error", errorCode: "internal", message: this.error });
      throw error;
    }
  }

  async stop(reason = "manual"): Promise<SessionSharingStatus> {
    if (this.state === "off") return this.getStatus();
    this.state = "stopping";
    this.emitStatus();
    await this.cleanup();
    this.state = "off";
    this.error = null;
    this.log({ kind: "service_stopped", message: reason });
    return this.getStatus();
  }

  async refreshCode(): Promise<SessionSharingStatus> {
    if (this.state !== "running") {
      throw new Error("Session sharing service is not running");
    }
    this.code = generateConnectionCode();
    this.touch();
    this.emitStatus();
    return this.getStatus();
  }

  async disconnectPeer(
    request: SessionSharingDisconnectPeerRequest,
  ): Promise<SessionSharingStatus> {
    const parsed = sessionSharingDisconnectPeerRequestSchema.parse(request);
    let disconnected: SessionSharingPeer | null = null;
    for (const [token, entry] of this.tokens) {
      if (entry.peer.id === parsed.peerId) {
        disconnected = entry.peer;
        this.tokens.delete(token);
      }
    }
    if (disconnected) {
      this.log({ kind: "peer_disconnected", peer: disconnected });
    }
    this.emitStatus();
    return this.getStatus();
  }

  async connectPeer(
    request: SessionSharingConnectPeerRequest,
  ): Promise<SessionSharingConnectPeerResponse> {
    const parsed = sessionSharingConnectPeerRequestSchema.parse(request);
    const baseUrl = normalizeBaseUrl(parsed.baseUrl);
    const pairResponse = await this.postPeerJson<SessionSharingPairResponse>(
      `${baseUrl}/v1/pair`,
      {
        code: parsed.code,
        client: this.clientInfo(),
      },
      sessionSharingPairResponseSchema,
    );
    const peerId = randomUUID();
    this.peerConnections.set(peerId, {
      peerId,
      baseUrl,
      token: pairResponse.token,
      deviceName: new URL(baseUrl).hostname,
      expiresAt: pairResponse.expiresAt,
    });
    const sessions = await this.listPeerSessions({ peerId });
    return {
      peer: {
        peerId,
        baseUrl,
        deviceName: new URL(baseUrl).hostname,
      },
      sessions: sessions.sessions,
    };
  }

  async listPeerSessions(
    request: SessionSharingListPeerSessionsRequest,
  ): Promise<SessionSharingListSessionsResponse> {
    const parsed = sessionSharingListPeerSessionsRequestSchema.parse(request);
    const connection = this.requirePeer(parsed.peerId);
    const query = new URLSearchParams();
    if (parsed.query?.trim()) query.set("q", parsed.query.trim());
    if (parsed.limit) query.set("limit", String(parsed.limit));
    if (parsed.cursor) query.set("cursor", parsed.cursor);
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return await this.getPeerJson<SessionSharingListSessionsResponse>(
      connection,
      `/v1/sessions${suffix}`,
      sessionSharingListSessionsResponseSchema,
    );
  }

  async previewPeerSession(
    request: SessionSharingPreviewPeerSessionRequest,
  ): Promise<SessionSharingPreviewResponse> {
    const parsed = sessionSharingPreviewPeerSessionRequestSchema.parse(request);
    const connection = this.requirePeer(parsed.peerId);
    const limit = parsed.limit ?? 20;
    return await this.getPeerJson<SessionSharingPreviewResponse>(
      connection,
      `/v1/sessions/${encodeURIComponent(parsed.sessionId)}/preview?limit=${limit}`,
      sessionSharingPreviewResponseSchema,
    );
  }

  async importPeerSession(
    request: SessionSharingImportPeerSessionRequest,
  ): Promise<SessionSharingImportPeerSessionResponse> {
    const parsed = sessionSharingImportPeerSessionRequestSchema.parse(request);
    const connection = this.requirePeer(parsed.peerId);
    const bundle = await this.fetchPeerBundle(connection, parsed.sessionId);
    const tempDir = await mkdtemp(join(tmpdir(), "zcode-session-share-import-"));
    try {
      await writeFile(join(tempDir, "bundle.json"), JSON.stringify(bundle), "utf8");
      await mkdirArtifacts(tempDir);
      for (const artifact of bundle.artifacts) {
        const bytes = await this.fetchPeerArtifact(
          connection,
          parsed.sessionId,
          artifact.artifactId,
        );
        if (bytes.byteLength !== artifact.sizeBytes) {
          throw new Error(`Session share artifact size mismatch: ${artifact.artifactId}`);
        }
        const written = join(tempDir, safeArtifactRelativePath(artifact.file));
        await writeFile(written, bytes);
      }
      const cliResult = await this.runCli(
        [
          "__session-share",
          "import",
          tempDir,
          "--workspace",
          parsed.workspacePath,
          ...(parsed.workspaceIdentity ? ["--identity", parsed.workspaceIdentity] : []),
        ],
        parsed.workspacePath,
      );
      const json = cliResult.json as {
        ok?: boolean;
        sessionId?: string;
        title?: string;
        reused?: boolean;
        importedMessages?: number;
        importedParts?: number;
        importedArtifacts?: number;
        skippedAttachments?: number;
        warnings?: string[];
        error?: string;
      };
      if (json.ok === false) {
        throw new Error(json.error ?? "Session share import failed");
      }
      return sessionSharingImportPeerSessionResponseSchema.parse({
        sessionId: json.sessionId,
        title: json.title ?? bundle.snapshot.session.title,
        workspacePath: parsed.workspacePath,
        reused: json.reused === true,
        importedMessages: json.importedMessages ?? 0,
        importedParts: json.importedParts ?? 0,
        importedArtifacts: json.importedArtifacts ?? bundle.artifacts.length,
        skippedAttachments: json.skippedAttachments ?? 0,
        warnings: json.warnings ?? [],
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async closePeer(request: SessionSharingClosePeerRequest): Promise<void> {
    const parsed = sessionSharingClosePeerRequestSchema.parse(request);
    this.peerConnections.delete(parsed.peerId);
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const remoteAddress = normalizeRemoteAddress(req.socket.remoteAddress);
    if (!isPrivateOrLoopbackAddress(remoteAddress)) {
      this.sendError(res, 403, "lan_only", "Session sharing is only available on the LAN");
      return;
    }
    const url = new URL(req.url ?? "/", `http://${this.address}:${this.port}`);
    try {
      if (req.method === "GET" && url.pathname === "/v1/health") {
        this.sendJson(res, 200, { schemaVersion: 1, service: "zcode-session-sharing" });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/pair") {
        await this.handlePair(req, res, remoteAddress);
        return;
      }
      const peer = this.authenticate(req);
      this.touch();
      if (req.method === "GET" && url.pathname === "/v1/sessions") {
        await this.handleList(url, res);
        return;
      }
      const artifactMatch = /^\/v1\/sessions\/([^/]+)\/artifacts\/([^/]+)$/u.exec(url.pathname);
      if (req.method === "GET" && artifactMatch) {
        await this.handleArtifact(
          decodeURIComponent(artifactMatch[1]!),
          decodeURIComponent(artifactMatch[2]!),
          res,
          peer,
        );
        return;
      }
      const exportMatch = /^\/v1\/sessions\/([^/]+)\/export$/u.exec(url.pathname);
      if (req.method === "GET" && exportMatch) {
        await this.handleExport(decodeURIComponent(exportMatch[1]!), res, peer);
        return;
      }
      const previewMatch = /^\/v1\/sessions\/([^/]+)\/preview$/u.exec(url.pathname);
      if (req.method === "GET" && previewMatch) {
        await this.handlePreview(decodeURIComponent(previewMatch[1]!), url, res);
        return;
      }
      const manifestMatch = /^\/v1\/sessions\/([^/]+)$/u.exec(url.pathname);
      if (req.method === "GET" && manifestMatch) {
        await this.handleManifest(decodeURIComponent(manifestMatch[1]!), res);
        return;
      }
      throw new SessionSharingHttpError(404, "session_not_found", "Not found");
    } catch (error) {
      this.handleError(res, error);
    }
  }

  private async handlePair(
    req: IncomingMessage,
    res: ServerResponse,
    remoteAddress: string | undefined,
  ): Promise<void> {
    const ip = remoteAddress ?? "unknown";
    try {
      this.assertPairRateLimit(ip);
      const parsed = sessionSharingPairRequestSchema.parse(
        await readJsonBody(req, MAX_JSON_BODY_BYTES),
      );
      if (
        !this.code ||
        normalizeSessionSharingCode(parsed.code) !== normalizeSessionSharingCode(this.code)
      ) {
        this.recordPairFailure(ip);
        this.log({
          kind: "pair_failed",
          errorCode: "pair_code_invalid",
          message: ip,
        });
        throw new SessionSharingHttpError(401, "pair_code_invalid", "Invalid connection code");
      }
      this.rateLimits.delete(ip);
      const now = this.now();
      const peer: SessionSharingPeer = {
        id: randomUUID(),
        name: parsed.client.name,
        platform: parsed.client.platform,
        appVersion: parsed.client.appVersion,
        address: ip,
        connectedAt: now,
        lastSeenAt: now,
      };
      const token = randomBytes(32).toString("base64url");
      this.tokens.set(token, { peer, expiresAt: now + TOKEN_TTL_MS });
      this.touch();
      this.log({ kind: "pair_succeeded", peer });
      this.sendJson(res, 200, {
        schemaVersion: 1,
        token,
        expiresAt: now + TOKEN_TTL_MS,
      } satisfies SessionSharingPairResponse);
    } catch (error) {
      if (error instanceof SessionSharingHttpError) throw error;
      if (error instanceof PairRateLimitError) {
        this.log({
          kind: "pair_failed",
          errorCode: "pair_locked",
          message: ip,
        });
        throw new SessionSharingHttpError(429, "pair_locked", error.message);
      }
      throw error;
    }
  }

  private async handleList(url: URL, res: ServerResponse): Promise<void> {
    const result = await this.listSessions();
    const query = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase();
    const limit = clampNumber(Number(url.searchParams.get("limit") ?? 50), 1, 100, 50);
    const filtered = query
      ? result.sessions.filter(
          (session) =>
            session.title.toLocaleLowerCase().includes(query) ||
            session.id.toLocaleLowerCase().includes(query),
        )
      : result.sessions;
    const sessions = filtered.slice(0, limit);
    this.sendJson(res, 200, {
      schemaVersion: 1,
      sessions,
      nextCursor: filtered.length > sessions.length ? (sessions.at(-1)?.id ?? null) : null,
    } satisfies SessionSharingListSessionsResponse);
  }

  private async handleManifest(sessionId: string, res: ServerResponse): Promise<void> {
    const entry = await this.ensureExport(sessionId);
    const manifest = buildManifest(entry.bundle);
    sessionSharingSessionManifestSchema.parse(manifest);
    this.sendJson(res, 200, manifest);
  }

  private async handlePreview(sessionId: string, url: URL, res: ServerResponse): Promise<void> {
    const entry = await this.ensureExport(sessionId);
    const limit = clampNumber(Number(url.searchParams.get("limit") ?? 20), 1, 50, 20);
    const preview = buildPreview(entry.bundle, limit);
    sessionSharingPreviewResponseSchema.parse(preview);
    this.sendJson(res, 200, preview);
  }

  private async handleExport(
    sessionId: string,
    res: ServerResponse,
    peer: SessionSharingPeer,
  ): Promise<void> {
    const entry = await this.ensureExport(sessionId);
    const fileStat = await stat(entry.bundlePath);
    res.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": String(fileStat.size),
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    const stream = createReadStream(entry.bundlePath);
    stream.on("error", (error) => {
      this.log({
        kind: "error",
        peer,
        sessionId,
        sessionTitle: entry.bundle.snapshot.session.title,
        errorCode: "internal",
        message: errorMessage(error),
      });
      res.destroy();
    });
    res.on("finish", () => {
      this.log({
        kind: "session_exported",
        peer,
        sessionId,
        sessionTitle: entry.bundle.snapshot.session.title,
        bytes: entry.result.sizeBytes ?? fileStat.size,
      });
    });
    stream.pipe(res);
  }

  private async handleArtifact(
    sessionId: string,
    artifactId: string,
    res: ServerResponse,
    peer: SessionSharingPeer,
  ): Promise<void> {
    const entry = await this.ensureExport(sessionId);
    const artifact = entry.bundle.artifacts.find(
      (candidate) => candidate.artifactId === artifactId,
    );
    if (!artifact) {
      throw new SessionSharingHttpError(404, "session_not_found", "Artifact not found");
    }
    const base = resolve(entry.dir);
    const filePath = resolve(base, artifact.file);
    if (!filePath.startsWith(`${base}${sep}`)) {
      throw new SessionSharingHttpError(400, "invalid_request", "Invalid artifact path");
    }
    const fileStat = await stat(filePath);
    res.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": String(fileStat.size),
      "Content-Type": artifact.mime || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "X-ZCode-Sha256": artifact.sha256,
    });
    createReadStream(filePath)
      .on("error", (error) => {
        this.log({
          kind: "artifact_failed",
          peer,
          sessionId,
          sessionTitle: entry.bundle.snapshot.session.title,
          errorCode: "internal",
          message: errorMessage(error),
        });
        res.destroy();
      })
      .pipe(res);
  }

  private async listSessions(): Promise<SessionSharingListSessionsResponse> {
    const now = this.now();
    if (this.listCache && now - this.listCache.at < LIST_CACHE_TTL_MS) {
      return this.listCache.result;
    }
    const cli = await this.runCli(["__session-share", "list", "--limit", "100"], process.cwd());
    const result = sessionSharingListSessionsResponseSchema.parse(cli.json);
    this.listCache = { at: now, result };
    return result;
  }

  private async ensureExport(sessionId: string): Promise<ExportCacheEntry> {
    const cached = this.exportCache.get(sessionId);
    if (cached && this.now() - cached.at < EXPORT_CACHE_TTL_MS) {
      return cached;
    }
    const inFlight = this.exportInFlight.get(sessionId);
    if (inFlight) return inFlight;
    const promise = this.exportSession(sessionId).finally(() => {
      this.exportInFlight.delete(sessionId);
    });
    this.exportInFlight.set(sessionId, promise);
    return await promise;
  }

  private async exportSession(sessionId: string): Promise<ExportCacheEntry> {
    if (!this.cacheDir) {
      this.cacheDir = await mkdtemp(join(tmpdir(), "zcode-session-share-"));
    }
    const dir = await mkdtemp(join(this.cacheDir, "export-"));
    try {
      const cli = await this.runCli(
        [
          "__session-share",
          "export",
          sessionId,
          "--out",
          dir,
          "--source-device-id",
          this.dependencies.deviceId,
          "--source-device-name",
          this.dependencies.deviceName,
          "--source-app-version",
          this.dependencies.appVersion,
          "--source-platform",
          process.platform,
        ],
        process.cwd(),
      );
      const result = cli.json as SessionShareCliExportResult;
      if (result.ok === false) {
        throw new Error(result.error ?? "Session export failed");
      }
      const bundlePath = result.bundlePath ?? join(dir, "bundle.json");
      const bundle = JSON.parse(await readFile(bundlePath, "utf8")) as SessionShareBundle;
      if (!isSessionSharingSchemaVersionSupported(bundle.schemaVersion)) {
        throw new Error(`Unsupported session share bundle version: ${bundle.schemaVersion}`);
      }
      if (bundle.snapshot.session.id !== sessionId) {
        throw new Error("Session share bundle does not match the requested session");
      }
      const entry: ExportCacheEntry = {
        dir,
        bundlePath,
        bundle,
        result,
        at: this.now(),
      };
      if (this.exportCache.size >= EXPORT_CACHE_LIMIT) {
        const oldest = [...this.exportCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) {
          this.exportCache.delete(oldest[0]);
          await rm(oldest[1].dir, { recursive: true, force: true }).catch(() => undefined);
        }
      }
      this.exportCache.set(sessionId, entry);
      return entry;
    } catch (error) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private authenticate(req: IncomingMessage): SessionSharingPeer {
    const authorization = req.headers.authorization;
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : "";
    const entry = token ? this.tokens.get(token) : undefined;
    const now = this.now();
    if (!entry || entry.expiresAt <= now) {
      if (token) this.tokens.delete(token);
      throw new SessionSharingHttpError(401, "unauthorized", "Unauthorized");
    }
    entry.expiresAt = now + TOKEN_TTL_MS;
    entry.peer.lastSeenAt = now;
    return entry.peer;
  }

  private touch(): void {
    this.lastActivityAt = this.now();
  }

  private startIdleTimer(): void {
    this.clearIdleTimer();
    if (this.idleStopMs <= 0) return;
    this.idleTimer = setInterval(() => {
      if (this.state !== "running") return;
      if (this.now() - this.lastActivityAt >= this.idleStopMs) {
        void this.stop("idle");
      }
    }, 30_000);
    this.idleTimer.unref?.();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private async cleanup(): Promise<void> {
    this.clearIdleTimer();
    const server = this.server;
    this.server = null;
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolveClose) => {
        const timer = setTimeout(resolveClose, 2_000);
        server.close(() => {
          clearTimeout(timer);
          resolveClose();
        });
      });
    }
    this.tokens.clear();
    this.peerConnections.clear();
    this.rateLimits.clear();
    this.exportCache.clear();
    this.exportInFlight.clear();
    this.listCache = null;
    const cacheDir = this.cacheDir;
    this.cacheDir = null;
    if (cacheDir) {
      await rm(cacheDir, { recursive: true, force: true }).catch(() => undefined);
    }
    this.address = null;
    this.port = null;
    this.code = null;
    this.startedAt = null;
    this.lastActivityAt = 0;
  }

  private assertPairRateLimit(ip: string): void {
    const now = this.now();
    const entry = this.rateLimits.get(ip);
    if (!entry) return;
    if (entry.lockedUntil > now) {
      throw new PairRateLimitError("Too many failed attempts");
    }
    if (now - entry.windowStart > 60_000) {
      this.rateLimits.delete(ip);
    }
  }

  private recordPairFailure(ip: string): void {
    const now = this.now();
    const entry = this.rateLimits.get(ip) ?? {
      attempts: 0,
      windowStart: now,
      lockedUntil: 0,
    };
    if (now - entry.windowStart > 60_000) {
      entry.attempts = 0;
      entry.windowStart = now;
      entry.lockedUntil = 0;
    }
    entry.attempts += 1;
    if (entry.attempts >= 5) {
      entry.lockedUntil = now + 10 * 60_000;
    }
    this.rateLimits.set(ip, entry);
  }

  private uniquePeers(): SessionSharingPeer[] {
    const peers = new Map<string, SessionSharingPeer>();
    for (const entry of this.tokens.values()) {
      peers.set(entry.peer.id, entry.peer);
    }
    return [...peers.values()];
  }

  private log(input: {
    kind: SessionSharingLogKind;
    peer?: SessionSharingPeer | null;
    sessionId?: string | null;
    sessionTitle?: string | null;
    bytes?: number | null;
    errorCode?: SessionSharingErrorCode | null;
    message?: string | null;
  }): void {
    const entry: SessionSharingLogEntry = {
      id: randomUUID(),
      at: this.now(),
      kind: input.kind,
      peer: input.peer ?? null,
      sessionId: input.sessionId ?? null,
      sessionTitle: input.sessionTitle ?? null,
      bytes: input.bytes ?? null,
      errorCode: input.errorCode ?? null,
      message: input.message ?? null,
    };
    this.logs.push(entry);
    if (this.logs.length > SESSION_SHARING_MAX_LOG_ENTRIES) {
      this.logs.splice(0, this.logs.length - SESSION_SHARING_MAX_LOG_ENTRIES);
    }
    this.dependencies.logger.info("[session-sharing]", {
      event: entry.kind,
      peerName: entry.peer?.name ?? null,
      peerAddress: entry.peer?.address ?? null,
      sessionId: entry.sessionId,
      bytes: entry.bytes,
      errorCode: entry.errorCode,
      message: entry.message,
    });
    this.emitStatus();
  }

  private emitStatus(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch {
        // 状态监听失败不能反向影响共享服务本身。
      }
    }
  }

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "Cache-Control": "no-store",
      "Content-Length": String(Buffer.byteLength(payload)),
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(payload);
  }

  private sendError(
    res: ServerResponse,
    status: number,
    code: SessionSharingErrorCode,
    message: string,
  ): void {
    this.sendJson(res, status, {
      schemaVersion: 1,
      error: { code, message },
    });
  }

  private handleError(res: ServerResponse, error: unknown): void {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (error instanceof SessionSharingHttpError) {
      this.sendError(res, error.status, error.code, error.message);
      return;
    }
    const message = errorMessage(error);
    const mapped = mapCliError(message);
    if (mapped.code === "internal") {
      this.log({ kind: "error", errorCode: "internal", message });
    }
    this.sendError(res, mapped.status, mapped.code, message);
  }

  private requirePeer(peerId: string): PeerConnection {
    const connection = this.peerConnections.get(peerId);
    if (!connection) {
      throw new Error("Session sharing peer connection is no longer available");
    }
    return connection;
  }

  private clientInfo(): SessionSharingClientInfo {
    return {
      name: this.dependencies.deviceName,
      platform: mapClientPlatform(process.platform),
      appVersion: this.dependencies.appVersion,
    };
  }

  private async postPeerJson<T>(
    url: string,
    body: unknown,
    schema?: { parse: (value: unknown) => T },
  ): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const parsed = await parsePeerResponse<unknown>(response);
    return schema ? schema.parse(parsed) : (parsed as T);
  }

  private async getPeerJson<T>(
    connection: PeerConnection,
    path: string,
    schema: { parse: (value: unknown) => T },
  ): Promise<T> {
    const response = await fetch(`${connection.baseUrl}${path}`, {
      headers: { authorization: `Bearer ${connection.token}` },
      signal: AbortSignal.timeout(30_000),
    });
    return schema.parse(await parsePeerResponse<unknown>(response));
  }

  private async fetchPeerBundle(
    connection: PeerConnection,
    sessionId: string,
  ): Promise<SessionShareBundle> {
    const response = await fetch(
      `${connection.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/export`,
      {
        headers: { authorization: `Bearer ${connection.token}` },
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!response.ok) {
      throw new Error(await buildHttpClientError(response, "Session export failed"));
    }
    const bundle = (await response.json()) as SessionShareBundle;
    if (!isSessionSharingSchemaVersionSupported(bundle.schemaVersion)) {
      throw new Error(`Unsupported session share bundle version: ${bundle.schemaVersion}`);
    }
    if (bundle.snapshot.session.id !== sessionId) {
      throw new Error("Session share bundle does not match the requested session");
    }
    return bundle;
  }

  private async fetchPeerArtifact(
    connection: PeerConnection,
    sessionId: string,
    artifactId: string,
  ): Promise<Buffer> {
    const response = await fetch(
      `${connection.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}`,
      {
        headers: { authorization: `Bearer ${connection.token}` },
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!response.ok) {
      throw new Error(await buildHttpClientError(response, "Session artifact fetch failed"));
    }
    return Buffer.from(await response.arrayBuffer());
  }
}

class PairRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PairRateLimitError";
  }
}

function generateConnectionCode(): string {
  const bytes = randomBytes(8);
  const chars = [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Session sharing peer must use http or https");
  }
  return url.toString().replace(/\/+$/u, "");
}

function mapClientPlatform(platform: NodeJS.Platform): SessionSharingClientInfo["platform"] {
  return platform === "darwin" || platform === "linux" || platform === "win32" ? platform : "other";
}

function buildManifest(bundle: SessionShareBundle): SessionSharingSessionManifest {
  return {
    schemaVersion: 1,
    session: {
      id: bundle.snapshot.session.id,
      title: bundle.snapshot.session.title,
      directory: bundle.snapshot.session.directory,
    },
    workspace: {
      path: bundle.source.workspacePath,
      gitHead: bundle.source.gitHead,
      gitDirty: bundle.source.gitDirty,
      platform: bundle.source.platform,
    },
    source: {
      deviceId: bundle.source.deviceId,
      deviceName: bundle.source.deviceName,
      appVersion: bundle.source.appVersion,
      exportedAt: bundle.source.exportedAt,
    },
    counts: {
      messages: bundle.snapshot.messages.length,
      parts: bundle.snapshot.messages.reduce((count, message) => count + message.parts.length, 0),
      entries: bundle.snapshot.entries.length,
      todos: bundle.snapshot.todos.length,
    },
    artifacts: bundle.artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      mime: artifact.mime,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
    })),
  };
}

function buildPreview(bundle: SessionShareBundle, limit: number): SessionSharingPreviewResponse {
  const messages: Array<{ role: "user" | "assistant"; text: string }> = [];
  for (const message of bundle.snapshot.messages) {
    const text = message.parts
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text!.trim())
      .filter(Boolean)
      .join("\n");
    if (!text) continue;
    messages.push({
      role: message.info.role,
      text: text.slice(0, MAX_PREVIEW_TEXT_CHARS),
    });
  }
  return {
    schemaVersion: 1,
    messages: messages.slice(-limit),
    truncated: messages.length > limit,
  };
}

async function readJsonBody(req: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > limit) {
      throw new SessionSharingHttpError(413, "payload_too_large", "Request body is too large");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function parsePeerResponse<T>(response: Awaited<ReturnType<typeof fetch>>): Promise<T> {
  if (!response.ok) {
    throw new Error(await buildHttpClientError(response, "Session sharing peer request failed"));
  }
  return (await response.json()) as T;
}

async function buildHttpClientError(
  response: Awaited<ReturnType<typeof fetch>>,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    const message =
      typeof body.error?.message === "string"
        ? body.error.message
        : typeof body.message === "string"
          ? body.message
          : undefined;
    return message ?? `${fallback} (HTTP ${response.status})`;
  } catch {
    return `${fallback} (HTTP ${response.status})`;
  }
}

function mapCliError(message: string): {
  status: number;
  code: SessionSharingErrorCode;
} {
  if (/Session not found/iu.test(message)) {
    return { status: 404, code: "session_not_found" };
  }
  if (/cannot be shared|is running|running tool/iu.test(message)) {
    return { status: 409, code: "session_busy" };
  }
  return { status: 500, code: "internal" };
}

function safeArtifactRelativePath(file: string): string {
  if (!file.startsWith("artifacts/") || file.includes("..")) {
    throw new Error("Invalid session share artifact path");
  }
  return file;
}

async function mkdirArtifacts(dir: string): Promise<void> {
  await mkdir(join(dir, "artifacts"), { recursive: true });
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function errorMessage(error: unknown): string {
  if (error instanceof SessionShareCliError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

// 供 IPC 注册读取默认 CLI 路径，失败在 start 时由上层提示。
export function getSessionShareCliPathForDiagnostics(): string {
  return resolveSessionShareCliPath();
}
