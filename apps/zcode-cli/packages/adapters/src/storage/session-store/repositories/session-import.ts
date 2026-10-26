import type { DatabaseSync } from "node:sqlite";
import type { SessionImportCommitBundle, SessionInfo } from "@zcode/contracts";
import * as messageRepository from "./messages.js";
import * as sessionEntryRepository from "./session-entries.js";
import * as sessionRepository from "./sessions.js";
import { replaceTodos } from "./todos.js";

/**
 * 跨机会话导入的单事务实现。
 *
 * message/part/entry 的 save 都是 upsert，不能依赖主键冲突兜底：写入前必须显式检查
 * ID 是否已被其它 session 占用，否则新导入会把旧会话的记录改绑走。
 */
export async function commitSessionImportBundle(
  db: DatabaseSync,
  bundle: SessionImportCommitBundle,
): Promise<SessionInfo> {
  assertSessionImportBundleLocal(bundle);
  db.exec("begin immediate");
  try {
    const existing = sessionRepository.getSession(db, bundle.session.id);
    if (existing) {
      // 同一源会话的重复导入按幂等处理；调用方负责用确定性 session ID 触发此分支。
      db.exec("commit");
      return existing;
    }
    assertSessionImportIdsAvailable(db, bundle);
    const persisted = sessionRepository.createSession(db, bundle.session);
    for (const message of bundle.messages) {
      await messageRepository.saveMessage(db, message.info);
      for (const part of message.parts) {
        await messageRepository.savePart(db, part);
      }
    }
    for (const entry of bundle.entries) {
      sessionEntryRepository.saveSessionEntry(db, entry);
    }
    replaceTodos(db, { sessionID: bundle.session.id, todos: bundle.todos });
    db.exec("commit");
    return persisted;
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}

function assertSessionImportBundleLocal(bundle: SessionImportCommitBundle): void {
  const sessionId = String(bundle.session.id);
  if (bundle.session.parentID) {
    throw new Error("Session import bundle must be a root session");
  }

  const messageIds = new Set<string>();
  for (const message of bundle.messages) {
    const messageId = String(message.info.id);
    if (messageIds.has(messageId)) {
      throw new Error(`Session import duplicate message id: ${messageId}`);
    }
    messageIds.add(messageId);
  }
  const assertMessageRef = (value: unknown, field: string) => {
    if (typeof value === "string" && !messageIds.has(value)) {
      throw new Error(`Session import ${field} is not local: ${value}`);
    }
  };

  const partIds = new Set<string>();
  for (const message of bundle.messages) {
    if (String(message.info.sessionID) !== sessionId) {
      throw new Error("Session import message session is not local");
    }
    if (message.info.role === "assistant" && !messageIds.has(String(message.info.parentID))) {
      throw new Error("Session import assistant parent is not local");
    }
    const anchor = message.info.anchor;
    for (const id of anchor?.orderedMessageIds ?? []) {
      assertMessageRef(id, "anchor orderedMessageId");
    }
    assertMessageRef(anchor?.boundaryMessageId, "anchor boundaryMessageId");
    if (anchor?.goalBoundary) {
      throw new Error("Session import does not support goal-boundary anchors");
    }

    for (const part of message.parts) {
      const partId = String(part.id);
      if (partIds.has(partId)) {
        throw new Error(`Session import duplicate part id: ${partId}`);
      }
      partIds.add(partId);
      if (
        String(part.sessionID) !== sessionId ||
        String(part.messageID) !== String(message.info.id)
      ) {
        throw new Error("Session import part owner is not local");
      }
      if (part.type === "timeline") {
        assertMessageRef(part.anchorMessageId, "timeline anchorMessageId");
        if (part.timelineType === "context_compaction") {
          assertMessageRef(part.summaryMessageId, "timeline summaryMessageId");
        }
      }
      if (part.type === "compaction") {
        assertMessageRef(part.tail_start_id, "compaction tail_start_id");
        assertMessageRef(part.summaryMessageId, "compaction summaryMessageId");
        const boundary = part.compactBoundary;
        assertMessageRef(boundary?.lastSummarizedMessageId, "compact lastSummarizedMessageId");
        for (const id of boundary?.summaryMessageIds ?? []) {
          assertMessageRef(id, "compact summaryMessageId");
        }
        for (const id of boundary?.attachmentMessageIds ?? []) {
          assertMessageRef(id, "compact attachmentMessageId");
        }
        for (const id of boundary?.hookResultMessageIds ?? []) {
          assertMessageRef(id, "compact hookResultMessageId");
        }
        assertMessageRef(boundary?.preservedSegment?.headMessageId, "compact preserved head");
        assertMessageRef(boundary?.preservedSegment?.anchorMessageId, "compact preserved anchor");
        assertMessageRef(boundary?.preservedSegment?.tailMessageId, "compact preserved tail");
      }
      if (part.type === "tool" && part.state.status === "completed") {
        for (const attachment of part.state.attachments ?? []) {
          if (
            String(attachment.sessionID) !== sessionId ||
            String(attachment.messageID) !== String(message.info.id)
          ) {
            throw new Error("Session import tool attachment owner is not local");
          }
        }
      }
    }
  }

  const entryIds = new Set<string>();
  for (const entry of bundle.entries) {
    if (String(entry.sessionID) !== sessionId) {
      throw new Error("Session import entry session is not local");
    }
    // session_entry.id 是全库主键；命名空间必须带新 session，避免重复导入时改绑条目。
    if (!entry.id.includes(sessionId)) {
      throw new Error("Session import entry id must be namespaced by session");
    }
    if (entryIds.has(entry.id)) {
      throw new Error(`Session import duplicate entry id: ${entry.id}`);
    }
    entryIds.add(entry.id);
  }
}

function assertSessionImportIdsAvailable(
  db: DatabaseSync,
  bundle: SessionImportCommitBundle,
): void {
  const findMessage = db.prepare("select id from message where id = ?");
  const findPart = db.prepare("select id from part where id = ?");
  const findEntry = db.prepare("select id from session_entry where id = ?");

  for (const message of bundle.messages) {
    const messageId = String(message.info.id);
    if (findMessage.get(messageId)) {
      throw new Error(`Session import message id already exists: ${messageId}`);
    }
    for (const part of message.parts) {
      const partId = String(part.id);
      if (findPart.get(partId)) {
        throw new Error(`Session import part id already exists: ${partId}`);
      }
    }
  }
  for (const entry of bundle.entries) {
    if (findEntry.get(entry.id)) {
      throw new Error(`Session import entry id already exists: ${entry.id}`);
    }
  }
}
