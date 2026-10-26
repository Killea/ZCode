import { useState } from "react";
import { Copy, Loader2, Play, RefreshCw, Share2, Square } from "lucide-react";
import type { SessionSharingLogEntry } from "@zcode/shared";
import { buildSessionSharingConnectionUrl } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getErrorMessage } from "@/lib/errorMessage.js";
import { cn } from "@/components/lib/utils.js";
import {
  SessionSharingDetailsDialog,
  SessionSharingImportDialog,
} from "@/session-sharing/SessionSharingDialogs.js";
import { useSessionSharingStatus } from "@/session-sharing/useSessionSharingStatus.js";

export interface SessionSharingPanelProps {
  className?: string;
  workspacePath: string;
  workspaceIdentity?: string;
}

export function SessionSharingPanel({
  className,
  workspacePath,
  workspaceIdentity,
}: SessionSharingPanelProps) {
  const { intl } = useZCodeIntl();
  const { supported, status, logs, refreshLogs, start, stop, refreshCode, disconnectPeer } =
    useSessionSharingStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  if (!supported) return null;

  const running = status.state === "running";
  const transitioning = status.state === "starting" || status.state === "stopping";
  const connectionUrl =
    status.address && status.port && status.code
      ? buildSessionSharingConnectionUrl({
          address: status.address,
          port: status.port,
          code: status.code,
        })
      : "";

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const copyConnection = () => {
    if (!connectionUrl) return;
    void navigator.clipboard.writeText(connectionUrl).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <>
      <div
        className={cn(
          "w-full rounded-xl border border-card-border bg-card/40 px-3 py-2.5 text-ui-caption",
          className,
        )}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span
            aria-hidden="true"
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              running
                ? "bg-success"
                : status.state === "error"
                  ? "bg-destructive"
                  : "bg-foreground-subtlest",
            )}
          />
          <span className="font-medium text-foreground">
            {running
              ? intl.formatMessage({ id: "sessionSharing.running" })
              : status.state === "error"
                ? intl.formatMessage({ id: "sessionSharing.error" })
                : intl.formatMessage({ id: "sessionSharing.off" })}
          </span>
          <span className="text-foreground-subtle">
            {running
              ? intl.formatMessage({ id: "sessionSharing.lanOnlyShort" })
              : intl.formatMessage({ id: "sessionSharing.offHint" })}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {running ? (
              <>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={copyConnection}
                  aria-label={intl.formatMessage({ id: "sessionSharing.copyConnection" })}
                >
                  <Copy />
                  {copied
                    ? intl.formatMessage({ id: "sessionSharing.copied" })
                    : intl.formatMessage({ id: "sessionSharing.copyConnection" })}
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  disabled={busy || transitioning}
                  onClick={() => void run(() => refreshCode())}
                  aria-label={intl.formatMessage({ id: "sessionSharing.refreshCode" })}
                >
                  <RefreshCw />
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={busy || transitioning}
                  onClick={() => void run(() => stop())}
                >
                  {busy || transitioning ? <Loader2 className="animate-spin" /> : <Square />}
                  {intl.formatMessage({ id: "sessionSharing.stop" })}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={busy || transitioning}
                onClick={() => void run(() => start({}))}
              >
                {busy || transitioning ? <Loader2 className="animate-spin" /> : <Play />}
                {busy || transitioning
                  ? intl.formatMessage({ id: "sessionSharing.starting" })
                  : intl.formatMessage({ id: "sessionSharing.start" })}
              </Button>
            )}
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => {
                setDetailsOpen(true);
                void refreshLogs();
              }}
            >
              {intl.formatMessage({ id: "sessionSharing.details" })}
            </Button>
          </div>
        </div>
        {running && status.address && status.port ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-foreground-subtle">
            <span className="min-w-0 truncate font-mono text-foreground" title={connectionUrl}>
              {connectionUrl}
            </span>
            <span>
              {intl.formatMessage({ id: "sessionSharing.peers" }, { count: status.peers.length })}
            </span>
          </div>
        ) : null}
        {status.lastEvent ? (
          <button
            type="button"
            className="mt-1 block max-w-full truncate text-left text-foreground-subtle hover:text-foreground"
            onClick={() => {
              setDetailsOpen(true);
              void refreshLogs();
            }}
          >
            {intl.formatMessage(
              { id: "sessionSharing.lastEvent" },
              { text: formatInlineLog(intl, status.lastEvent) },
            )}
          </button>
        ) : null}
        {error ? <p className="mt-1 text-destructive">{error}</p> : null}
        {status.error ? (
          <p className="mt-1 truncate text-destructive" title={status.error}>
            {status.error}
          </p>
        ) : null}
        <div className="mt-1">
          <Button
            type="button"
            size="xs"
            variant="link"
            className="h-auto px-0 text-ui-caption"
            onClick={() => setImportOpen(true)}
          >
            <Share2 />
            {intl.formatMessage({ id: "sessionSharing.import" })}
          </Button>
        </div>
      </div>
      <SessionSharingDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        status={status}
        logs={logs}
        onRefreshLogs={refreshLogs}
        onDisconnectPeer={disconnectPeer}
      />
      <SessionSharingImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        workspacePath={workspacePath}
        {...(workspaceIdentity ? { workspaceIdentity } : {})}
      />
    </>
  );
}

function formatInlineLog(
  intl: ReturnType<typeof useZCodeIntl>["intl"],
  entry: SessionSharingLogEntry,
): string {
  const key = `sessionSharing.log.${entry.kind}`;
  return intl.formatMessage(
    { id: key },
    {
      name: entry.peer?.name ?? intl.formatMessage({ id: "sessionSharing.unknownDevice" }),
      title: entry.sessionTitle ?? "",
      code: entry.errorCode ?? "",
    },
  );
}
