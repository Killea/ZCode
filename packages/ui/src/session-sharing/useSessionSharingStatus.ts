import { useCallback, useEffect, useState } from "react";
import type {
  SessionSharingLogEntry,
  SessionSharingStartRequest,
  SessionSharingStatus,
} from "@zcode/shared";
import { usePlatform } from "@/hooks/usePlatform.js";
import { logger } from "@/logger.js";

const OFF_STATUS: SessionSharingStatus = {
  state: "off",
  address: null,
  port: null,
  code: null,
  startedAt: null,
  idleStopAt: null,
  peers: [],
  lastEvent: null,
  error: null,
};

export function useSessionSharingStatus(): {
  supported: boolean;
  status: SessionSharingStatus;
  logs: SessionSharingLogEntry[];
  refreshLogs: () => Promise<void>;
  start: (options?: SessionSharingStartRequest) => Promise<SessionSharingStatus | undefined>;
  stop: () => Promise<SessionSharingStatus | undefined>;
  refreshCode: () => Promise<SessionSharingStatus | undefined>;
  disconnectPeer: (peerId: string) => Promise<SessionSharingStatus | undefined>;
} {
  const platform = usePlatform();
  const supported = typeof platform.getSessionSharingStatus === "function";
  const [status, setStatus] = useState<SessionSharingStatus>(OFF_STATUS);
  const [logs, setLogs] = useState<SessionSharingLogEntry[]>([]);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await platform.getSessionSharingStatus?.();
        if (!cancelled && next) setStatus(next);
      } catch (error) {
        logger.warn("[session-sharing] get status failed", error);
      }
    })();
    const dispose = platform.onSessionSharingStatusChanged?.((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [platform, supported]);

  const refreshLogs = useCallback(async () => {
    if (!supported) return;
    try {
      const next = await platform.getSessionSharingLogs?.();
      if (next) setLogs(next);
    } catch (error) {
      logger.warn("[session-sharing] get logs failed", error);
    }
  }, [platform, supported]);

  const start = useCallback(
    async (options?: SessionSharingStartRequest) => {
      const next = await platform.startSessionSharing?.(options ?? {});
      if (next) setStatus(next);
      return next;
    },
    [platform],
  );

  const stop = useCallback(async () => {
    const next = await platform.stopSessionSharing?.();
    if (next) setStatus(next);
    return next;
  }, [platform]);

  const refreshCode = useCallback(async () => {
    const next = await platform.refreshSessionSharingCode?.();
    if (next) setStatus(next);
    return next;
  }, [platform]);

  const disconnectPeer = useCallback(
    async (peerId: string) => {
      const next = await platform.disconnectSessionSharingPeer?.({ peerId });
      if (next) setStatus(next);
      return next;
    },
    [platform],
  );

  return {
    supported,
    status,
    logs,
    refreshLogs,
    start,
    stop,
    refreshCode,
    disconnectPeer,
  };
}
