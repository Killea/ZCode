import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNodeToolArtifactStore, createSqliteSessionStore } from "@zcode/adapters/storage";
import {
  SESSION_ENTRY_BASH_SHELL_SELECTION,
  SESSION_ENTRY_MODEL_SELECTION,
  createMessageId,
  createPartId,
  createProjectId,
  createSessionId,
  type AssistantMessageInfo,
  type FilePart,
  type MessagePart,
  type UserMessageInfo,
} from "@zcode/contracts";
import {
  importSessionTransferSnapshot,
  readSessionTransferArtifact,
  readSessionTransferSnapshot,
} from "../src/session-transfer/index.js";

describe("session transfer snapshot", () => {
  it("exports and imports artifacts, todos, portable entries and strips source env", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "zcode-session-transfer-"));
    const sourceArtifacts = createNodeToolArtifactStore({
      imageCacheRootDir: join(tempRoot, "source-image-cache"),
      rootDir: join(tempRoot, "source-artifacts"),
      videoCacheRootDir: join(tempRoot, "source-video-cache"),
    });
    const targetArtifacts = createNodeToolArtifactStore({
      imageCacheRootDir: join(tempRoot, "target-image-cache"),
      rootDir: join(tempRoot, "target-artifacts"),
      videoCacheRootDir: join(tempRoot, "target-video-cache"),
    });
    const sourceStore = createSqliteSessionStore({ dbPath: ":memory:" });
    const targetStore = createSqliteSessionStore({ dbPath: ":memory:" });
    const sourceSessionId = createSessionId("transfer-source");
    const sourceWorkspacePath = "/home/hank/Flux2Image";
    const targetWorkspacePath = "/Users/hank/Flux2Image";
    const now = Date.now();

    try {
      await sourceStore.createSession({
        id: sourceSessionId,
        projectID: createProjectId("source-project"),
        slug: "transfer-source",
        directory: sourceWorkspacePath,
        path: sourceWorkspacePath,
        title: "重构登录流程",
        titleSource: "custom",
        version: "3.15.1",
        permission: { mode: "build" },
        time: { created: 1_000, updated: 2_000 },
      });

      const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
      const artifact = await sourceArtifacts.writeToolResultBinaryArtifact!({
        sessionId: sourceSessionId,
        toolCallId: "call-1",
        toolName: "read",
        content: bytes,
        contentType: "image/png",
      });

      const userMessageId = createMessageId("transfer-user");
      const assistantMessageId = createMessageId("transfer-assistant");
      const userMessage: UserMessageInfo = {
        id: userMessageId,
        sessionID: sourceSessionId,
        role: "user",
        time: { created: 1_000 },
        agent: "zcode-agent",
        contextSnapshot: {
          envInfo: {
            cwd: sourceWorkspacePath,
            platform: "linux",
            shell: "/bin/bash",
            osVersion: "Linux",
            nodeVersion: "24.0.0",
            isGitRepository: true,
            gitBranch: "dev",
            gitStatus: "dirty",
          },
        },
      };
      const assistantMessage: AssistantMessageInfo = {
        id: assistantMessageId,
        sessionID: sourceSessionId,
        role: "assistant",
        time: { created: 2_000, completed: 2_000 },
        parentID: userMessageId,
        mode: "build",
        agent: "zcode-agent",
        path: { cwd: sourceWorkspacePath, root: sourceWorkspacePath },
        cost: 0,
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      };
      const userTextPart: MessagePart = {
        id: createPartId("transfer-user-text"),
        sessionID: sourceSessionId,
        messageID: userMessageId,
        type: "text",
        text: "帮我重构登录",
        time: { start: 1_000, end: 1_000 },
      };
      const userFilePart: MessagePart = {
        id: createPartId("transfer-user-file"),
        sessionID: sourceSessionId,
        messageID: userMessageId,
        type: "file",
        mime: "image/png",
        filename: "screenshot.png",
        url: artifact.uri,
        metadata: {
          artifactUri: artifact.uri,
          storageKind: "artifact",
          recoverability: "provider_ready",
        },
      };
      const assistantTextPart: MessagePart = {
        id: createPartId("transfer-assistant-text"),
        sessionID: sourceSessionId,
        messageID: assistantMessageId,
        type: "text",
        text: "已完成",
        time: { start: 2_000, end: 2_000 },
      };
      await sourceStore.saveMessage(userMessage);
      await sourceStore.savePart(userTextPart);
      await sourceStore.savePart(userFilePart);
      await sourceStore.saveMessage(assistantMessage);
      await sourceStore.savePart(assistantTextPart);
      await sourceStore.saveSessionEntry!({
        id: `runtime/model_selection:${sourceSessionId}`,
        sessionID: sourceSessionId,
        type: SESSION_ENTRY_MODEL_SELECTION,
        time: { created: 1_000, updated: 1_000 },
        data: null,
      });
      await sourceStore.saveSessionEntry!({
        id: `runtime/bash_shell_selection:${sourceSessionId}`,
        sessionID: sourceSessionId,
        type: SESSION_ENTRY_BASH_SHELL_SELECTION,
        time: { created: 1_000, updated: 1_000 },
        data: { shell: "/bin/bash" },
      });
      await sourceStore.updateTodos({
        sessionID: sourceSessionId,
        todos: [{ content: "继续实现", status: "pending", priority: "high" }],
      });

      const snapshot = await readSessionTransferSnapshot({
        sessionID: sourceSessionId,
        sessionStore: sourceStore,
      });
      expect(snapshot.artifactUris).toEqual([artifact.uri]);
      expect(snapshot.entries.map((entry) => entry.type)).toEqual([SESSION_ENTRY_MODEL_SELECTION]);
      expect(snapshot.droppedEntryCount).toBe(1);

      const transferArtifact = await readSessionTransferArtifact(artifact.uri, sourceArtifacts);
      expect(transferArtifact.sha256).toHaveLength(64);
      expect(transferArtifact.bytes).toEqual(bytes);

      const result = await importSessionTransferSnapshot({
        snapshot,
        artifacts: [transferArtifact],
        source: {
          deviceId: "device-linux",
          deviceName: "linux-dev",
          appVersion: "3.15.1",
          exportedAt: now,
          workspacePath: sourceWorkspacePath,
          gitHead: "abc123",
          gitDirty: true,
          platform: "linux",
        },
        target: {
          workspacePath: targetWorkspacePath,
          workspaceIdentity: "ws_mac",
        },
        sessionStore: targetStore,
        artifactStore: targetArtifacts,
        now,
      });

      expect(result.reused).toBe(false);
      expect(result.sessionId).toMatch(/^sess_import_/u);
      expect(result.importedMessages).toBe(2);
      expect(result.importedArtifacts).toBe(1);
      expect(result.warnings).toContain("source_workspace_dirty");
      expect(result.warnings).toContain("machine_local_entries_dropped");

      const imported = await targetStore.getSession(result.sessionId);
      expect(imported).toMatchObject({
        directory: targetWorkspacePath,
        path: targetWorkspacePath,
        taskType: "interactive",
        title: "重构登录流程",
        workspaceID: "ws_mac",
        time: { created: 1_000 },
      });
      expect(imported?.time.updated).toBeGreaterThanOrEqual(now);
      expect(imported?.parentID).toBeUndefined();

      const messages = await targetStore.messages({ sessionID: result.sessionId });
      expect(messages.map((message) => message.info.id)).toEqual([
        userMessageId,
        assistantMessageId,
      ]);
      expect(messages[0]?.info.sessionID).toBe(result.sessionId);
      const importedUserInfo = messages[0]!.info as UserMessageInfo;
      const importedAssistantInfo = messages[1]!.info as AssistantMessageInfo;
      expect(importedUserInfo.contextSnapshot).toBeUndefined();
      expect(importedAssistantInfo.path).toEqual({
        cwd: targetWorkspacePath,
        root: targetWorkspacePath,
      });

      const importedFilePart = messages[0]?.parts.find(
        (part): part is FilePart => part.type === "file",
      );
      expect(importedFilePart).toBeDefined();
      expect(importedFilePart?.url).not.toBe(artifact.uri);
      expect(importedFilePart?.url.startsWith(`zcode-artifact://${result.sessionId}/`)).toBe(true);
      const importedArtifactBytes = await targetArtifacts.readToolResultBinaryArtifact!({
        uri: importedFilePart!.url,
      });
      expect(importedArtifactBytes.bytes).toEqual(bytes);

      const entries = await targetStore.sessionEntries({ sessionID: result.sessionId });
      expect(entries.some((entry) => entry.type === SESSION_ENTRY_MODEL_SELECTION)).toBe(true);
      expect(entries.some((entry) => entry.type === SESSION_ENTRY_BASH_SHELL_SELECTION)).toBe(
        false,
      );
      expect(
        entries.find((entry) => entry.type === "runtime/remote_session_import")?.data,
      ).toMatchObject({
        sourceDeviceId: "device-linux",
        sourceSessionId,
        mode: "copy",
      });
      expect(await targetStore.readTodos({ sessionID: result.sessionId })).toEqual([
        { content: "继续实现", status: "pending", priority: "high" },
      ]);

      const repeated = await importSessionTransferSnapshot({
        snapshot,
        artifacts: [],
        source: {
          deviceId: "device-linux",
          deviceName: "linux-dev",
          appVersion: "3.15.1",
          exportedAt: now,
          workspacePath: sourceWorkspacePath,
          gitHead: "abc123",
          gitDirty: true,
          platform: "linux",
        },
        target: {
          workspacePath: targetWorkspacePath,
          workspaceIdentity: "ws_mac",
        },
        sessionStore: targetStore,
        artifactStore: targetArtifacts,
        now,
      });
      expect(repeated.reused).toBe(true);
      expect(await targetStore.messages({ sessionID: result.sessionId })).toHaveLength(2);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects an import whose artifact set is incomplete", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "zcode-session-transfer-missing-"));
    const sourceStore = createSqliteSessionStore({ dbPath: ":memory:" });
    const targetStore = createSqliteSessionStore({ dbPath: ":memory:" });
    const sourceArtifacts = createNodeToolArtifactStore({
      imageCacheRootDir: join(tempRoot, "source-image-cache"),
      rootDir: join(tempRoot, "source-artifacts"),
      videoCacheRootDir: join(tempRoot, "source-video-cache"),
    });
    const targetArtifacts = createNodeToolArtifactStore({
      imageCacheRootDir: join(tempRoot, "target-image-cache"),
      rootDir: join(tempRoot, "target-artifacts"),
      videoCacheRootDir: join(tempRoot, "target-video-cache"),
    });
    const sourceSessionId = createSessionId("transfer-missing-artifact");
    try {
      await sourceStore.createSession({
        id: sourceSessionId,
        projectID: createProjectId("source-project"),
        slug: "transfer-missing-artifact",
        directory: "/home/hank/project",
        path: "/home/hank/project",
        title: "Missing artifact",
        version: "3.15.1",
        time: { created: 1_000, updated: 2_000 },
      });
      const artifact = await sourceArtifacts.writeToolResultBinaryArtifact!({
        sessionId: sourceSessionId,
        toolCallId: "call-1",
        toolName: "read",
        content: Uint8Array.from([1, 2, 3]),
        contentType: "application/octet-stream",
      });
      const messageId = createMessageId("missing-artifact-user");
      await sourceStore.saveMessage({
        id: messageId,
        sessionID: sourceSessionId,
        role: "user",
        time: { created: 1_000 },
        agent: "zcode-agent",
      });
      await sourceStore.savePart({
        id: createPartId("missing-artifact-file"),
        sessionID: sourceSessionId,
        messageID: messageId,
        type: "file",
        mime: "application/octet-stream",
        url: artifact.uri,
        metadata: { artifactUri: artifact.uri, storageKind: "artifact" },
      });
      const snapshot = await readSessionTransferSnapshot({
        sessionID: sourceSessionId,
        sessionStore: sourceStore,
      });
      await expect(
        importSessionTransferSnapshot({
          snapshot,
          artifacts: [],
          source: {
            deviceId: "device-linux",
            deviceName: "linux-dev",
            appVersion: "3.15.1",
            exportedAt: 3_000,
            workspacePath: "/home/hank/project",
            gitHead: null,
            gitDirty: null,
            platform: "linux",
          },
          target: { workspacePath: "/Users/hank/project" },
          sessionStore: targetStore,
          artifactStore: targetArtifacts,
        }),
      ).rejects.toThrow("Session transfer artifact is missing");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
