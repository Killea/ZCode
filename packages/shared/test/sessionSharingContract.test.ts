import { describe, expect, it } from "vitest";

import {
  buildSessionSharingConnectionUrl,
  isSessionSharingSchemaVersionSupported,
  normalizeSessionSharingCode,
  parseSessionSharingConnectionUrl,
  sessionSharingCodeSchema,
  sessionSharingExportRecordSchema,
  sessionSharingPairRequestSchema,
  sessionSharingPairResponseSchema,
  sessionSharingSessionManifestSchema,
  sessionSharingStatusSchema,
} from "../src/session-sharing.js";

const SHA_256 = "a".repeat(64);

const manifest = {
  schemaVersion: 1,
  session: {
    id: "sess_123",
    title: "重构登录流程",
    directory: "/home/hank/Flux2Image",
  },
  workspace: {
    path: "/home/hank/Flux2Image",
    gitHead: "abc123",
    gitDirty: true,
    platform: "linux",
  },
  source: {
    deviceId: "device-linux",
    deviceName: "linux-dev",
    appVersion: "3.15.1",
    exportedAt: 1_788_415_000_000,
  },
  counts: { messages: 2, parts: 4, entries: 1, todos: 1 },
  artifacts: [
    {
      artifactId: "tool-result-1",
      mime: "image/png",
      sizeBytes: 1234,
      sha256: SHA_256,
    },
  ],
};

describe("session sharing contract", () => {
  it("normalizes connection codes without ambiguous characters", () => {
    expect(sessionSharingCodeSchema.parse("a7k2-9qmx")).toBe("A7K2-9QMX");
    expect(normalizeSessionSharingCode("a7k29qmx")).toBe("A7K2-9QMX");
    expect(sessionSharingCodeSchema.safeParse("A7K2-9QMI").success).toBe(false);
  });

  it("round-trips the one-line connection URL", () => {
    const url = buildSessionSharingConnectionUrl({
      address: "192.168.1.23",
      port: 51234,
      code: "a7k2-9qmx",
    });
    expect(url).toBe("http://192.168.1.23:51234/#code=A7K2-9QMX");
    expect(parseSessionSharingConnectionUrl(url)).toEqual({
      baseUrl: "http://192.168.1.23:51234",
      code: "A7K2-9QMX",
    });
    expect(parseSessionSharingConnectionUrl("http://192.168.1.23:51234/#code=bad")).toBeNull();
    expect(parseSessionSharingConnectionUrl("ftp://192.168.1.23:51234/#code=A7K2-9QMX")).toBeNull();
  });

  it("validates pair request and response envelopes", () => {
    expect(
      sessionSharingPairRequestSchema.parse({
        code: "A7K2-9QMX",
        client: { name: "MacBook-Pro", platform: "darwin", appVersion: "3.15.1" },
      }),
    ).toMatchObject({ code: "A7K2-9QMX" });

    expect(
      sessionSharingPairResponseSchema.parse({
        schemaVersion: 1,
        token: "x".repeat(43),
        expiresAt: 1_788_415_000_000,
      }),
    ).toMatchObject({ schemaVersion: 1 });
  });

  it("validates the export manifest record and keeps business payload opaque", () => {
    expect(
      sessionSharingExportRecordSchema.parse({ kind: "manifest", data: manifest }),
    ).toMatchObject({ kind: "manifest" });

    expect(
      sessionSharingExportRecordSchema.parse({
        kind: "message",
        data: { id: "msg_1", role: "user" },
      }),
    ).toMatchObject({ kind: "message" });

    expect(
      sessionSharingSessionManifestSchema.safeParse({ ...manifest, schemaVersion: 2 }).success,
    ).toBe(false);
  });

  it("validates service status and schema version support", () => {
    expect(
      sessionSharingStatusSchema.parse({
        state: "running",
        address: "192.168.1.23",
        port: 51234,
        code: "A7K2-9QMX",
        startedAt: 1_788_415_000_000,
        idleStopAt: 1_788_416_800_000,
        peers: [],
        lastEvent: null,
        error: null,
      }),
    ).toMatchObject({ state: "running" });

    expect(isSessionSharingSchemaVersionSupported(1)).toBe(true);
    expect(isSessionSharingSchemaVersionSupported(2)).toBe(false);
    expect(isSessionSharingSchemaVersionSupported(0)).toBe(false);
  });
});
