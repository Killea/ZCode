import { useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SessionSharingDetailsDialog } from "@/session-sharing/SessionSharingDialogs.js";
import { useSessionSharingStatus } from "@/session-sharing/useSessionSharingStatus.js";

export function SessionSharingHeaderButton() {
  const { intl } = useZCodeIntl();
  const { supported, status, logs, refreshLogs, disconnectPeer } = useSessionSharingStatus();
  const [open, setOpen] = useState(false);

  if (!supported || status.state !== "running") return null;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={intl.formatMessage({ id: "sessionSharing.openDetails" })}
        onClick={() => {
          setOpen(true);
          void refreshLogs();
        }}
        className="relative"
      >
        <Share2 />
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-success"
        />
      </Button>
      <SessionSharingDetailsDialog
        open={open}
        onOpenChange={setOpen}
        status={status}
        logs={logs}
        onRefreshLogs={refreshLogs}
        onDisconnectPeer={disconnectPeer}
      />
    </>
  );
}
