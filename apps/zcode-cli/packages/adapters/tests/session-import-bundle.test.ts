import { describe, expect, it } from "vitest";
import {
  createMessageId,
  createPartId,
  createProjectId,
  createSessionId,
  type AssistantMessageInfo,
  type MessageId,
  type SessionEntryInfo,
  type SessionImportCommitBundle,
  type UserMessageInfo,
} from "@zcode/contracts";
import { createSqliteSessionStore } from "../src/storage/index.js";

function createImportBundle(params: {
  sessionSlug: string;
  messageSlug?: string;
  entryId?: string;
  assistantParentId?: string;
}): SessionImportCommitBundle {
  const sessionID = createSessionId(params.sessionSlug);
  const userMessageId = createMessageId(`${params.messageSlug ?? params.sessionSlug}-user`);
  const assistantMessageId = createMessageId(
    `${params.messageSlug ?? params.sessionSlug}-assistant`,
  );
  const now = 1_788_415_000_000;

  const userMessage: UserMessageInfo = {
    id: userMessageId,
    sessionID,
    role: "user",
    time: { created: now },
    agent: "zcode-agent",
  };
  const assistantMessage: AssistantMessageInfo = {
    id: assistantMessageId,
    sessionID,
    role: "assistant",
    time: { created: now, completed: now },
    parentID: (params.assistantParentId ?? userMessageId) as MessageId,
    mode: "build",
    agent: "zcode-agent",
    path: { cwd: "/workspace/imported", root: "/workspace/imported" },
    cost: 0,
    tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
  };
  const entry: SessionEntryInfo = {
    id: params.entryId ?? `runtime/remote_session_import:${sessionID}:source-1`,
    sessionID,
    type: "runtime/remote_session_import",
    time: { created: now, updated: now },
    data: { sourceSessionId: "sess_source", sourceDeviceName: "linux-dev" },
  };

  return {
    session: {
      id: sessionID,
      projectID: createProjectId("import-project"),
      slug: params.sessionSlug,
      directory: "/workspace/imported",
      path: "/workspace/imported",
      title: "Imported session",
      titleSource: "custom",
      permission: { mode: "build" },
      version: "3.15.1",
      time: { created: now, updated: now },
    },
    messages: [
      {
        info: userMessage,
        parts: [
          {
            id: createPartId(`${params.sessionSlug}-user-part`),
            sessionID,
            messageID: userMessageId,
            type: "text",
            text: "继续之前的任务",
            time: { start: now, end: now },
          },
        ],
      },
      {
        info: assistantMessage,
        parts: [
          {
            id: createPartId(`${params.sessionSlug}-assistant-part`),
            sessionID,
            messageID: assistantMessageId,
            type: "text",
            text: "已了解上下文",
            time: { start: now, end: now },
          },
        ],
      },
    ],
    entries: [entry],
    todos: [{ content: "继续实现导入", status: "pending", priority: "high" }],
  };
}

describe("session import transaction", () => {
  it("atomically stores session, messages, entries and todos", async () => {
    const store = createSqliteSessionStore({ dbPath: ":memory:" });
    const bundle = createImportBundle({ sessionSlug: "import-target" });

    await expect(store.commitSessionImportBundle?.(bundle)).resolves.toMatchObject({
      id: bundle.session.id,
    });

    const messages = await store.messages({ sessionID: bundle.session.id });
    expect(messages).toHaveLength(2);
    expect(messages[0]?.parts[0]).toMatchObject({ type: "text", text: "继续之前的任务" });
    expect(await store.readTodos({ sessionID: bundle.session.id })).toEqual([
      { content: "继续实现导入", status: "pending", priority: "high" },
    ]);
    expect(await store.sessionEntries({ sessionID: bundle.session.id })).toMatchObject([
      { type: "runtime/remote_session_import" },
    ]);
  });

  it("returns the existing session on a repeated import", async () => {
    const store = createSqliteSessionStore({ dbPath: ":memory:" });
    const bundle = createImportBundle({ sessionSlug: "idempotent-import" });

    await store.commitSessionImportBundle?.(bundle);
    await expect(store.commitSessionImportBundle?.(bundle)).resolves.toMatchObject({
      id: bundle.session.id,
    });
    expect(await store.messages({ sessionID: bundle.session.id })).toHaveLength(2);
  });

  it("rejects an entry id that is not namespaced by the target session", async () => {
    const store = createSqliteSessionStore({ dbPath: ":memory:" });
    const bundle = createImportBundle({
      sessionSlug: "bad-entry-import",
      entryId: "runtime/remote_session_import:source-1",
    });

    await expect(store.commitSessionImportBundle?.(bundle)).rejects.toThrow(
      "Session import entry id must be namespaced by session",
    );
  });

  it("rejects a dangling assistant parent reference", async () => {
    const store = createSqliteSessionStore({ dbPath: ":memory:" });
    const bundle = createImportBundle({
      sessionSlug: "bad-parent-import",
      assistantParentId: "msg_missing",
    });

    await expect(store.commitSessionImportBundle?.(bundle)).rejects.toThrow(
      "Session import assistant parent is not local",
    );
  });

  it("rolls back the session when a message id collides with another import", async () => {
    const store = createSqliteSessionStore({ dbPath: ":memory:" });
    const first = createImportBundle({ sessionSlug: "first-import", messageSlug: "shared" });
    const second = createImportBundle({ sessionSlug: "second-import", messageSlug: "shared" });

    await store.commitSessionImportBundle?.(first);
    await expect(store.commitSessionImportBundle?.(second)).rejects.toThrow();
    await expect(store.getSession(second.session.id)).resolves.toBeNull();
  });
});
