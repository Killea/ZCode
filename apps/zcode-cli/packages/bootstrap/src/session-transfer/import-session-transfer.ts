import { createHash } from "node:crypto";
import type {
  CreateSessionInput,
  SessionEntryInfo,
  SessionId,
  WorkspaceId,
} from "@zcode/contracts";
import { projectIdFromDirectory } from "../app/paths.js";
import {
  SESSION_TRANSFER_PORTABLE_ENTRY_TYPES,
  buildImportedSessionId,
  countLocalReferenceFileParts,
  retargetSessionTransferMessage,
  type ImportSessionTransferInput,
  type ImportSessionTransferResult,
} from "./session-transfer.js";

const REMOTE_SESSION_IMPORT_ENTRY_TYPE = "runtime/remote_session_import";

export async function importSessionTransferSnapshot(
  input: ImportSessionTransferInput,
): Promise<ImportSessionTransferResult> {
  const { snapshot, source, target, sessionStore } = input;
  const now = input.now ?? Date.now();
  if (!target.workspacePath.trim()) {
    throw new Error("Target workspace path is required");
  }

  const { sessionId: importedSessionId, seed } = buildImportedSessionId(
    source.deviceId,
    String(snapshot.session.id),
  );
  const skippedAttachments = countLocalReferenceFileParts(snapshot.messages);
  const importedParts = snapshot.messages.reduce((count, message) => {
    return count + message.parts.length;
  }, 0);

  const existing = await sessionStore.getSession(importedSessionId);
  if (existing) {
    await assertImportedSessionIdentity({
      sessionStore,
      sessionId: importedSessionId,
      sourceDeviceId: source.deviceId,
      sourceSessionId: String(snapshot.session.id),
    });
    return {
      sessionId: importedSessionId,
      reused: true,
      importedMessages: snapshot.messages.length,
      importedParts,
      importedArtifacts: snapshot.artifactUris.length,
      skippedAttachments,
      warnings: buildWarnings(snapshot, skippedAttachments, source),
    };
  }
  if (!sessionStore.commitSessionImportBundle) {
    throw new Error("Target session store does not support session import");
  }

  const artifactUris = await writeSessionTransferArtifacts({
    artifacts: input.artifacts,
    artifactStore: input.artifactStore,
    sessionId: importedSessionId,
    requiredUris: snapshot.artifactUris,
  });

  const messages = snapshot.messages.map((message) =>
    retargetSessionTransferMessage({
      message,
      sessionID: importedSessionId,
      workspacePath: target.workspacePath,
      artifactUris,
    }),
  );
  const entries = buildImportedEntries({ snapshot, source, importedSessionId, now });
  const session: CreateSessionInput = {
    id: importedSessionId,
    projectID: projectIdFromDirectory(target.workspacePath),
    ...(target.workspaceIdentity ? { workspaceID: target.workspaceIdentity as WorkspaceId } : {}),
    taskType: "interactive",
    slug: `import_${seed}`,
    directory: target.workspacePath,
    path: target.workspacePath,
    title: snapshot.session.title.trim() || "Imported session",
    titleSource: "custom",
    version: snapshot.session.version,
    ...(snapshot.session.permission ? { permission: snapshot.session.permission } : {}),
    time: { created: snapshot.session.time.created, updated: now },
  };

  await sessionStore.commitSessionImportBundle({
    session,
    messages,
    entries,
    todos: structuredClone(snapshot.todos),
  });

  return {
    sessionId: importedSessionId,
    reused: false,
    importedMessages: messages.length,
    importedParts,
    importedArtifacts: artifactUris.size,
    skippedAttachments,
    warnings: buildWarnings(snapshot, skippedAttachments, source),
  };
}

async function assertImportedSessionIdentity(params: {
  sessionStore: ImportSessionTransferInput["sessionStore"];
  sessionId: SessionId;
  sourceDeviceId: string;
  sourceSessionId: string;
}): Promise<void> {
  if (!params.sessionStore.sessionEntries) return;
  const entries = await params.sessionStore.sessionEntries({
    sessionID: params.sessionId,
    type: REMOTE_SESSION_IMPORT_ENTRY_TYPE,
  });
  const data =
    entries[0]?.data && typeof entries[0].data === "object" && !Array.isArray(entries[0].data)
      ? (entries[0].data as Record<string, unknown>)
      : null;
  if (
    !data ||
    data.sourceDeviceId !== params.sourceDeviceId ||
    data.sourceSessionId !== params.sourceSessionId
  ) {
    throw new Error("Imported session identity collision");
  }
}

async function writeSessionTransferArtifacts(params: {
  artifacts: ImportSessionTransferInput["artifacts"];
  artifactStore: ImportSessionTransferInput["artifactStore"];
  sessionId: SessionId;
  requiredUris: readonly string[];
}): Promise<ReadonlyMap<string, string>> {
  const rewritten = new Map<string, string>();
  if (params.requiredUris.length === 0) return rewritten;

  const artifactByUri = new Map<string, ImportSessionTransferInput["artifacts"][number]>();
  for (const artifact of params.artifacts) {
    if (artifactByUri.has(artifact.sourceUri)) {
      throw new Error(`Duplicate session transfer artifact: ${artifact.sourceUri}`);
    }
    artifactByUri.set(artifact.sourceUri, artifact);
  }
  for (const uri of params.requiredUris) {
    if (!artifactByUri.has(uri)) {
      throw new Error(`Session transfer artifact is missing: ${uri}`);
    }
  }

  const artifactStore = params.artifactStore;
  if (!artifactStore?.writeToolResultBinaryArtifact) {
    throw new Error("Target artifact store does not support binary writes");
  }
  for (const uri of params.requiredUris) {
    const artifact = artifactByUri.get(uri)!;
    const written = await artifactStore.writeToolResultBinaryArtifact({
      sessionId: params.sessionId,
      toolCallId: artifact.artifactId,
      toolName: "session-import",
      content: artifact.bytes,
      contentType: artifact.mime || "application/octet-stream",
    });
    rewritten.set(uri, written.uri);
  }
  return rewritten;
}

function buildImportedEntries(params: {
  snapshot: ImportSessionTransferInput["snapshot"];
  source: ImportSessionTransferInput["source"];
  importedSessionId: SessionId;
  now: number;
}): SessionEntryInfo[] {
  const entries: SessionEntryInfo[] = [];
  for (const entry of params.snapshot.entries) {
    if (!SESSION_TRANSFER_PORTABLE_ENTRY_TYPES.has(entry.type)) continue;
    const suffix = createHash("sha256").update(entry.id).digest("hex").slice(0, 12);
    entries.push({
      ...structuredClone(entry),
      id: `${entry.type}:${params.importedSessionId}:${suffix}`,
      sessionID: params.importedSessionId,
      touchSession: false,
    });
  }
  entries.push({
    id: `${REMOTE_SESSION_IMPORT_ENTRY_TYPE}:${params.importedSessionId}`,
    sessionID: params.importedSessionId,
    type: REMOTE_SESSION_IMPORT_ENTRY_TYPE,
    touchSession: false,
    time: { created: params.now, updated: params.now },
    data: {
      sourceDeviceId: params.source.deviceId,
      sourceDeviceName: params.source.deviceName,
      sourceAppVersion: params.source.appVersion,
      sourceSessionId: String(params.snapshot.session.id),
      sourceWorkspacePath: params.source.workspacePath,
      sourceGitHead: params.source.gitHead,
      sourceGitDirty: params.source.gitDirty,
      sourcePlatform: params.source.platform,
      exportedAt: params.source.exportedAt,
      importedAt: params.now,
      mode: "copy",
    },
  });
  return entries;
}

function buildWarnings(
  snapshot: ImportSessionTransferInput["snapshot"],
  skippedAttachments: number,
  source: ImportSessionTransferInput["source"],
): string[] {
  const warnings: string[] = [];
  if (snapshot.droppedEntryCount > 0) warnings.push("machine_local_entries_dropped");
  if (skippedAttachments > 0) warnings.push("local_reference_attachments_skipped");
  if (source.gitDirty === true) warnings.push("source_workspace_dirty");
  return warnings;
}
