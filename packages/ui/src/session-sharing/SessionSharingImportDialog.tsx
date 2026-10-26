import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { SessionSharingPreviewMessage, SessionSharingSessionSummary } from "@zcode/shared";
import { parseSessionSharingConnectionUrl } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { ScrollFadeViewport } from "@/components/ui/scroll-fade-viewport.js";
import { toast } from "@/components/ui/toast.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getErrorMessage } from "@/lib/errorMessage.js";

export interface SessionSharingImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspacePath: string;
  workspaceIdentity?: string;
}

export function SessionSharingImportDialog({
  open,
  onOpenChange,
  workspacePath,
  workspaceIdentity,
}: SessionSharingImportDialogProps) {
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  const [connectionInput, setConnectionInput] = useState("");
  const [peerId, setPeerId] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [sessions, setSessions] = useState<SessionSharingSessionSummary[]>([]);
  const [query, setQuery] = useState("");
  const [sessionIdInput, setSessionIdInput] = useState("");
  const [preview, setPreview] = useState<{
    sessionId: string;
    messages: SessionSharingPreviewMessage[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setConnectionInput("");
    setPeerId(null);
    setDeviceName("");
    setSessions([]);
    setQuery("");
    setSessionIdInput("");
    setPreview(null);
    setBusy(false);
    setImportingId(null);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (open || !peerId) return;
    void platform.closeSessionSharingPeer?.({ peerId });
    setPeerId(null);
    setSessions([]);
    setPreview(null);
  }, [open, peerId, platform]);

  const filteredSessions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return sessions;
    return sessions.filter(
      (session) =>
        session.title.toLocaleLowerCase().includes(normalized) ||
        session.id.toLocaleLowerCase().includes(normalized),
    );
  }, [query, sessions]);

  const connect = async () => {
    if (!platform.connectSessionSharingPeer) return;
    const connection = parseSessionSharingConnectionUrl(connectionInput);
    if (!connection) {
      setError(intl.formatMessage({ id: "sessionSharing.connectionInvalid" }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await platform.connectSessionSharingPeer({
        baseUrl: connection.baseUrl,
        code: connection.code,
        client: { name: "ZCode", platform: "other", appVersion: "unknown" },
      });
      setPeerId(result.peer.peerId);
      setDeviceName(result.peer.deviceName);
      setSessions(result.sessions);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const refreshSessions = async () => {
    if (!peerId || !platform.listSessionSharingPeerSessions) return;
    setBusy(true);
    setError(null);
    try {
      const result = await platform.listSessionSharingPeerSessions({ peerId, limit: 100 });
      setSessions(result.sessions);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const previewSession = async (sessionId: string) => {
    if (!peerId || !platform.previewSessionSharingPeerSession) return;
    setError(null);
    try {
      const result = await platform.previewSessionSharingPeerSession({
        peerId,
        sessionId,
        limit: 12,
      });
      setPreview({ sessionId, messages: result.messages });
    } catch (cause) {
      setError(getErrorMessage(cause));
    }
  };

  const importSession = async (sessionId: string) => {
    if (!peerId || !platform.importSessionSharingPeerSession || !sessionId.trim()) return;
    if (!workspacePath.trim()) {
      setError(intl.formatMessage({ id: "sessionSharing.workspaceRequired" }));
      return;
    }
    setImportingId(sessionId);
    setError(null);
    try {
      const result = await platform.importSessionSharingPeerSession({
        peerId,
        sessionId: sessionId.trim(),
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
      });
      toast(
        result.reused
          ? intl.formatMessage({ id: "sessionSharing.importReused" })
          : intl.formatMessage({ id: "sessionSharing.importSuccess" }, { title: result.title }),
      );
      window.dispatchEvent(
        new CustomEvent("zcode:session-sharing-open", {
          detail: {
            workspacePath: result.workspacePath,
            ...(workspaceIdentity ? { workspaceIdentity } : {}),
            sessionId: result.sessionId,
          },
        }),
      );
      onOpenChange(false);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setImportingId(null);
    }
  };

  const disconnectDevice = () => {
    if (peerId) void platform.closeSessionSharingPeer?.({ peerId });
    setPeerId(null);
    setDeviceName("");
    setSessions([]);
    setPreview(null);
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(44rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: "sessionSharing.importTitle" })}</DialogTitle>
        </DialogHeader>
        {!peerId ? (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-ui-caption text-foreground-subtle">
              {intl.formatMessage({ id: "sessionSharing.connectionInfo" })}
              <Input
                value={connectionInput}
                onChange={(event) => setConnectionInput(event.target.value)}
                placeholder="http://192.168.1.23:51234/#code=A7K2-9QMX"
                autoFocus
              />
            </label>
            <p className="text-ui-caption text-foreground-subtle">
              {intl.formatMessage({ id: "sessionSharing.importConnectHint" })}
            </p>
            {error ? <p className="text-ui-caption text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button
                type="button"
                size="sm"
                onClick={() => void connect()}
                disabled={busy || !connectionInput.trim()}
              >
                {busy ? <Loader2 className="animate-spin" /> : null}
                {busy
                  ? intl.formatMessage({ id: "sessionSharing.connecting" })
                  : intl.formatMessage({ id: "sessionSharing.connect" })}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex items-center justify-between gap-2 text-ui-caption">
              <span className="min-w-0 truncate text-foreground">
                {intl.formatMessage({ id: "sessionSharing.connectedTo" }, { name: deviceName })}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => void refreshSessions()}
                  disabled={busy}
                >
                  <RefreshCw />
                  {intl.formatMessage({ id: "sessionSharing.refresh" })}
                </Button>
                <Button type="button" size="xs" variant="ghost" onClick={disconnectDevice}>
                  {intl.formatMessage({ id: "sessionSharing.changeDevice" })}
                </Button>
              </div>
            </div>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={intl.formatMessage({ id: "sessionSharing.searchSessions" })}
            />
            <ScrollFadeViewport className="max-h-[18rem] rounded-lg border border-card-border bg-card/30 p-2">
              {filteredSessions.length === 0 ? (
                <p className="text-ui-caption text-foreground-subtle">
                  {intl.formatMessage({ id: "sessionSharing.noSessions" })}
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {filteredSessions.map((session) => {
                    const running = session.status === "running";
                    return (
                      <li
                        key={session.id}
                        className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-hover"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-ui-base text-foreground">{session.title}</p>
                          <p className="truncate text-ui-caption text-foreground-subtle">
                            {session.workspacePath} · {session.messageCount} messages ·{" "}
                            {running
                              ? intl.formatMessage({ id: "sessionSharing.running" })
                              : intl.formatMessage({ id: "sessionSharing.idle" })}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            onClick={() => void previewSession(session.id)}
                          >
                            {intl.formatMessage({ id: "sessionSharing.preview" })}
                          </Button>
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            disabled={running || importingId !== null}
                            onClick={() => void importSession(session.id)}
                          >
                            {importingId === session.id ? (
                              <Loader2 className="animate-spin" />
                            ) : null}
                            {importingId === session.id
                              ? intl.formatMessage({ id: "sessionSharing.importing" })
                              : intl.formatMessage({ id: "sessionSharing.importAction" })}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ScrollFadeViewport>
            <div className="flex items-center gap-2">
              <Input
                value={sessionIdInput}
                onChange={(event) => setSessionIdInput(event.target.value)}
                placeholder={intl.formatMessage({ id: "sessionSharing.sessionIdPlaceholder" })}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!sessionIdInput.trim() || importingId !== null}
                onClick={() => void importSession(sessionIdInput)}
              >
                {intl.formatMessage({ id: "sessionSharing.importAction" })}
              </Button>
            </div>
            {preview ? (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-card-border bg-card/30 p-2">
                {preview.messages.length === 0 ? (
                  <p className="text-ui-caption text-foreground-subtle">
                    {intl.formatMessage({ id: "sessionSharing.previewEmpty" })}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {preview.messages.map((message, index) => (
                      <li key={`${preview.sessionId}-${index}`} className="text-ui-caption">
                        <span className="mr-2 font-medium text-foreground">
                          {message.role === "user"
                            ? intl.formatMessage({ id: "sessionSharing.roleUser" })
                            : intl.formatMessage({ id: "sessionSharing.roleAssistant" })}
                        </span>
                        <span className="whitespace-pre-wrap text-foreground-subtle">
                          {message.text.slice(0, 500)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
            <p className="text-ui-caption text-foreground-subtle">
              {intl.formatMessage(
                { id: "sessionSharing.importWorkspaceHint" },
                { path: workspacePath },
              )}
            </p>
            {error ? <p className="text-ui-caption text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
                {intl.formatMessage({ id: "sessionSharing.close" })}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
