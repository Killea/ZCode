import { useEffect, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import type { SessionSharingLogEntry, SessionSharingStatus } from "@zcode/shared";
import { buildSessionSharingConnectionUrl } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { ScrollFadeViewport } from "@/components/ui/scroll-fade-viewport.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export interface SessionSharingDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: SessionSharingStatus;
  logs: SessionSharingLogEntry[];
  onRefreshLogs: () => Promise<void>;
  onDisconnectPeer: (peerId: string) => Promise<unknown>;
}

export function SessionSharingDetailsDialog({
  open,
  onOpenChange,
  status,
  logs,
  onRefreshLogs,
  onDisconnectPeer,
}: SessionSharingDetailsDialogProps) {
  const { intl, locale } = useZCodeIntl();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) void onRefreshLogs();
  }, [open, onRefreshLogs]);

  const connectionUrl =
    status.state === "running" && status.address && status.port && status.code
      ? buildSessionSharingConnectionUrl({
          address: status.address,
          port: status.port,
          code: status.code,
        })
      : "";

  const logLines = logs.map(
    (entry) => `${formatLogTime(entry.at, locale)} ${formatLogEntry(intl, entry)}`,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(36rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: "sessionSharing.detailsTitle" })}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-card-border bg-card/40 px-3 py-2 text-ui-caption">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <StatusLine status={status} intl={intl} />
              {connectionUrl ? (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    void navigator.clipboard.writeText(connectionUrl).then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 2000);
                    });
                  }}
                >
                  <Copy />
                  {copied
                    ? intl.formatMessage({ id: "sessionSharing.copied" })
                    : intl.formatMessage({ id: "sessionSharing.copyConnection" })}
                </Button>
              ) : null}
            </div>
            {connectionUrl ? (
              <p className="mt-1 break-all font-mono text-foreground-subtle">{connectionUrl}</p>
            ) : null}
            <p className="mt-1 text-foreground-subtle">
              {intl.formatMessage({ id: "sessionSharing.lanOnly" })}
            </p>
          </div>
          <section className="flex flex-col gap-2">
            <h3 className="text-ui-caption font-medium text-foreground">
              {intl.formatMessage({ id: "sessionSharing.connectedDevices" })}
            </h3>
            {status.peers.length === 0 ? (
              <p className="text-ui-caption text-foreground-subtle">
                {intl.formatMessage({ id: "sessionSharing.noPeers" })}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {status.peers.map((peer) => (
                  <li
                    key={peer.id}
                    className="flex items-center gap-2 rounded-md bg-card/40 px-2 py-1.5 text-ui-caption"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-foreground">{peer.name}</p>
                      <p className="truncate text-foreground-subtle">
                        {peer.address} · {peer.platform} · {peer.appVersion}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => void onDisconnectPeer(peer.id)}
                    >
                      {intl.formatMessage({ id: "sessionSharing.disconnect" })}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-ui-caption font-medium text-foreground">
                {intl.formatMessage({ id: "sessionSharing.logsTitle" })}
              </h3>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => void onRefreshLogs()}
                  aria-label={intl.formatMessage({ id: "sessionSharing.refreshLogs" })}
                >
                  <RefreshCw />
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    void navigator.clipboard.writeText(logLines.join("\n"));
                  }}
                >
                  <Copy />
                  {intl.formatMessage({ id: "sessionSharing.copyLogs" })}
                </Button>
              </div>
            </div>
            <ScrollFadeViewport className="max-h-64 rounded-lg border border-card-border bg-card/30 p-2">
              {logs.length === 0 ? (
                <p className="text-ui-caption text-foreground-subtle">
                  {intl.formatMessage({ id: "sessionSharing.logEmpty" })}
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {logs
                    .slice()
                    .reverse()
                    .map((entry) => (
                      <li key={entry.id} className="text-ui-caption text-foreground-subtle">
                        <span className="mr-2 shrink-0 tabular-nums">
                          {formatLogTime(entry.at, locale)}
                        </span>
                        <span className="text-foreground">{formatLogEntry(intl, entry)}</span>
                        {entry.message ? (
                          <span className="ml-2 break-all text-foreground-subtle">
                            {entry.message}
                          </span>
                        ) : null}
                      </li>
                    ))}
                </ul>
              )}
            </ScrollFadeViewport>
          </section>
        </div>
        <DialogFooter>
          <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            {intl.formatMessage({ id: "sessionSharing.close" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusLine({
  status,
  intl,
}: {
  status: SessionSharingStatus;
  intl: ReturnType<typeof useZCodeIntl>["intl"];
}) {
  if (status.state !== "running" || !status.address || !status.port) {
    return <p className="text-foreground">{intl.formatMessage({ id: "sessionSharing.off" })}</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="font-mono text-foreground">
        {status.address}:{status.port}
      </span>
      <span className="text-foreground-subtle">
        {intl.formatMessage({ id: "sessionSharing.code" })}
      </span>
      <span className="font-mono text-foreground">{status.code}</span>
      <span className="text-foreground-subtle">
        {intl.formatMessage({ id: "sessionSharing.peers" }, { count: status.peers.length })}
      </span>
    </div>
  );
}

function formatLogEntry(
  intl: ReturnType<typeof useZCodeIntl>["intl"],
  entry: SessionSharingLogEntry,
): string {
  const key = `sessionSharing.log.${entry.kind}`;
  const base = intl.formatMessage(
    { id: key },
    {
      name: entry.peer?.name ?? intl.formatMessage({ id: "sessionSharing.unknownDevice" }),
      title: entry.sessionTitle ?? "",
      code: entry.errorCode ?? "",
    },
  );
  return entry.bytes && entry.bytes > 0 ? `${base} · ${formatBytes(entry.bytes)}` : base;
}

function formatLogTime(at: number, locale: string): string {
  return new Date(at).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
