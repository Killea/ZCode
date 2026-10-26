import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SessionSharingListSessionsResponse, SessionSharingPairResponse } from "@zcode/shared";
import {
  SessionSharingService,
  type SessionSharingServiceDependencies,
} from "../src/main/sessionSharing/sessionSharingService.js";
import { resolveSessionShareCliPath } from "../src/main/sessionSharing/sessionShareCli.js";
import type { SessionShareCliResult } from "../src/main/sessionSharing/sessionShareCli.js";

const SOURCE_SESSION_ID = "sess_source";
const ARTIFACT_ID = "art-1";
const ARTIFACT_URI = `zcode-artifact://${SOURCE_SESSION_ID}/${ARTIFACT_ID}`;
const ARTIFACT_BYTES = Buffer.from("hello artifact");
const ARTIFACT_SHA256 = createHash("sha256").update(ARTIFACT_BYTES).digest("hex");

const listResponse: SessionSharingListSessionsResponse = {
  schemaVersion: 1,
  sessions: [
    {
      id: SOURCE_SESSION_ID,
      title: "Source session",
      workspacePath: "/home/source",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      messageCount: 1,
      partCount: 1,
      status: "idle",
      sizeBytes: 0,
      artifactCount: 1,
      taskType: "interactive",
      parentID: null,
    },
  ],
  nextCursor: null,
};

function sourceBundle() {
  return {
    schemaVersion: 1,
    exportedAt: 1_700_000_000_000,
    source: {
      deviceId: "device-source",
      deviceName: "source-device",
      appVersion: "1.0.0",
      exportedAt: 1_700_000_000_000,
      workspacePath: "/home/source",
      gitHead: null,
      gitDirty: null,
      platform: "linux",
    },
    snapshot: {
      session: {
        id: SOURCE_SESSION_ID,
        title: "Source session",
        directory: "/home/source",
      },
      messages: [
        {
          info: { role: "user", time: { created: 1_700_000_000_000 } },
          parts: [{ type: "text", text: "hello from source" }],
        },
      ],
      entries: [],
      todos: [],
      artifactUris: [ARTIFACT_URI],
      droppedEntryCount: 0,
    },
    artifacts: [
      {
        artifactId: ARTIFACT_ID,
        mime: "text/plain",
        sizeBytes: ARTIFACT_BYTES.byteLength,
        sha256: ARTIFACT_SHA256,
        file: `artifacts/${ARTIFACT_ID}.bin`,
      },
    ],
  };
}

function createFakeRunCli(): SessionSharingServiceDependencies["runCli"] {
  return async (args: string[]): Promise<SessionShareCliResult> => {
    if (args[0] !== "__session-share") {
      throw new Error(`unexpected CLI args: ${args.join(" ")}`);
    }
    if (args[1] === "list") {
      return { json: listResponse, stdout: "", stderr: "" };
    }
    if (args[1] === "export") {
      const outIndex = args.indexOf("--out");
      const outDir = args[outIndex + 1]!;
      await mkdir(join(outDir, "artifacts"), { recursive: true });
      await writeFile(join(outDir, "artifacts", `${ARTIFACT_ID}.bin`), ARTIFACT_BYTES);
      const bundle = sourceBundle();
      const bundlePath = join(outDir, "bundle.json");
      await writeFile(bundlePath, JSON.stringify(bundle));
      return {
        json: {
          ok: true,
          bundlePath,
          sessionId: SOURCE_SESSION_ID,
          title: "Source session",
          messageCount: 1,
          partCount: 1,
          artifactCount: 1,
          sizeBytes: JSON.stringify(bundle).length + ARTIFACT_BYTES.byteLength,
        },
        stdout: "",
        stderr: "",
      };
    }
    if (args[1] === "import") {
      const dir = args[2]!;
      const bundle = JSON.parse(await readFile(join(dir, "bundle.json"), "utf8")) as {
        snapshot: { session: { title: string } };
      };
      const artifact = await readFile(join(dir, "artifacts", `${ARTIFACT_ID}.bin`));
      expect(artifact).toEqual(ARTIFACT_BYTES);
      return {
        json: {
          ok: true,
          sessionId: "sess_import_test",
          title: bundle.snapshot.session.title,
          reused: false,
          importedMessages: 1,
          importedParts: 1,
          importedArtifacts: 1,
          skippedAttachments: 0,
          warnings: [],
        },
        stdout: "",
        stderr: "",
      };
    }
    throw new Error(`unexpected CLI mode: ${args[1]}`);
  };
}

describe("session sharing service", () => {
  it("resolves the repository CLI bundle for the dev runtime", () => {
    expect(resolveSessionShareCliPath()).toContain("apps/zcode-cli");
  });

  it("pairs, serves a session and imports it through the CLI boundary", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "zcode-session-sharing-service-"));
    const service = new SessionSharingService({
      appVersion: "1.0.0",
      deviceId: "device-test",
      deviceName: "test-device",
      logger: { info() {}, warn() {}, error() {} },
      resolveAddresses: () => [{ address: "127.0.0.1", interfaceName: "lo" }],
      runCli: createFakeRunCli(),
    });
    try {
      const status = await service.start({ idleStopMs: 60_000 });
      expect(status.state).toBe("running");
      expect(status.port).not.toBeNull();
      const baseUrl = `http://127.0.0.1:${status.port}`;
      const client = { name: "target", platform: "linux" as const, appVersion: "1.0.0" };

      const unauthorized = await fetch(`${baseUrl}/v1/sessions`);
      expect(unauthorized.status).toBe(401);

      const wrongCode = await fetch(`${baseUrl}/v1/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "AAAA-AAAA", client }),
      });
      expect(wrongCode.status).toBe(401);

      const pair = await fetch(`${baseUrl}/v1/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: status.code, client }),
      });
      expect(pair.status).toBe(200);
      const pairJson = (await pair.json()) as SessionSharingPairResponse;

      const list = await fetch(`${baseUrl}/v1/sessions`, {
        headers: { authorization: `Bearer ${pairJson.token}` },
      });
      expect(list.status).toBe(200);
      await expect(list.json()).resolves.toMatchObject({
        sessions: [{ id: SOURCE_SESSION_ID }],
      });

      const manifest = await fetch(`${baseUrl}/v1/sessions/${SOURCE_SESSION_ID}`, {
        headers: { authorization: `Bearer ${pairJson.token}` },
      });
      expect(manifest.status).toBe(200);
      await expect(manifest.json()).resolves.toMatchObject({
        workspace: { path: "/home/source" },
        counts: { messages: 1, parts: 1 },
        artifacts: [{ artifactId: ARTIFACT_ID }],
      });

      const preview = await fetch(`${baseUrl}/v1/sessions/${SOURCE_SESSION_ID}/preview?limit=5`, {
        headers: { authorization: `Bearer ${pairJson.token}` },
      });
      expect(preview.status).toBe(200);
      await expect(preview.json()).resolves.toMatchObject({
        messages: [{ role: "user", text: "hello from source" }],
      });

      const exported = await fetch(`${baseUrl}/v1/sessions/${SOURCE_SESSION_ID}/export`, {
        headers: { authorization: `Bearer ${pairJson.token}` },
      });
      expect(exported.status).toBe(200);
      const exportedText = await exported.text();
      expect(JSON.parse(exportedText).snapshot.session.id).toBe(SOURCE_SESSION_ID);

      const artifact = await fetch(
        `${baseUrl}/v1/sessions/${SOURCE_SESSION_ID}/artifacts/${ARTIFACT_ID}`,
        { headers: { authorization: `Bearer ${pairJson.token}` } },
      );
      expect(artifact.status).toBe(200);
      expect(Buffer.from(await artifact.arrayBuffer())).toEqual(ARTIFACT_BYTES);

      await new Promise((resolve) => setTimeout(resolve, 10));
      const logKinds = service.getLogs().map((entry) => entry.kind);
      expect(logKinds).toContain("pair_succeeded");
      expect(logKinds).toContain("session_exported");

      const connection = await service.connectPeer({
        baseUrl,
        code: status.code!,
        client,
      });
      expect(connection.sessions).toHaveLength(1);
      const previewFromPeer = await service.previewPeerSession({
        peerId: connection.peer.peerId,
        sessionId: SOURCE_SESSION_ID,
      });
      expect(previewFromPeer.messages[0]?.text).toBe("hello from source");

      const imported = await service.importPeerSession({
        peerId: connection.peer.peerId,
        sessionId: SOURCE_SESSION_ID,
        workspacePath: "/tmp/imported-workspace",
      });
      expect(imported).toMatchObject({
        sessionId: "sess_import_test",
        title: "Source session",
        workspacePath: "/tmp/imported-workspace",
        reused: false,
      });

      await service.stop("test");
      await expect(fetch(`${baseUrl}/v1/health`)).rejects.toThrow();
    } finally {
      await service.stop("cleanup").catch(() => undefined);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
