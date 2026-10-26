import { BrowserWindow, ipcMain } from "electron";
import {
  PlatformChannels,
  type SessionSharingClosePeerRequest,
  type SessionSharingConnectPeerRequest,
  type SessionSharingDisconnectPeerRequest,
  type SessionSharingImportPeerSessionRequest,
  type SessionSharingListPeerSessionsRequest,
  type SessionSharingPreviewPeerSessionRequest,
  type SessionSharingStartRequest,
} from "@zcode/shared";
import type { SessionSharingService } from "./sessionSharing/sessionSharingService.js";

export function registerSessionSharingIpcHandlers(service: SessionSharingService): () => void {
  const disposeStatus = service.onStatusChanged((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(PlatformChannels.SessionSharingStatusChanged, status);
      }
    }
  });

  ipcMain.handle(
    PlatformChannels.StartSessionSharing,
    (_event, options?: SessionSharingStartRequest) => service.start(options),
  );
  ipcMain.handle(PlatformChannels.StopSessionSharing, () => service.stop("manual"));
  ipcMain.handle(PlatformChannels.GetSessionSharingStatus, () => service.getStatus());
  ipcMain.handle(PlatformChannels.GetSessionSharingLogs, () => service.getLogs());
  ipcMain.handle(PlatformChannels.RefreshSessionSharingCode, () => service.refreshCode());
  ipcMain.handle(
    PlatformChannels.DisconnectSessionSharingPeer,
    (_event, request: SessionSharingDisconnectPeerRequest) => service.disconnectPeer(request),
  );
  ipcMain.handle(
    PlatformChannels.ConnectSessionSharingPeer,
    (_event, request: SessionSharingConnectPeerRequest) => service.connectPeer(request),
  );
  ipcMain.handle(
    PlatformChannels.ListSessionSharingPeerSessions,
    (_event, request: SessionSharingListPeerSessionsRequest) => service.listPeerSessions(request),
  );
  ipcMain.handle(
    PlatformChannels.PreviewSessionSharingPeerSession,
    (_event, request: SessionSharingPreviewPeerSessionRequest) =>
      service.previewPeerSession(request),
  );
  ipcMain.handle(
    PlatformChannels.ImportSessionSharingPeerSession,
    (_event, request: SessionSharingImportPeerSessionRequest) => service.importPeerSession(request),
  );
  ipcMain.handle(
    PlatformChannels.CloseSessionSharingPeer,
    (_event, request: SessionSharingClosePeerRequest) => service.closePeer(request),
  );

  return () => {
    disposeStatus();
    ipcMain.removeHandler(PlatformChannels.StartSessionSharing);
    ipcMain.removeHandler(PlatformChannels.StopSessionSharing);
    ipcMain.removeHandler(PlatformChannels.GetSessionSharingStatus);
    ipcMain.removeHandler(PlatformChannels.GetSessionSharingLogs);
    ipcMain.removeHandler(PlatformChannels.RefreshSessionSharingCode);
    ipcMain.removeHandler(PlatformChannels.DisconnectSessionSharingPeer);
    ipcMain.removeHandler(PlatformChannels.ConnectSessionSharingPeer);
    ipcMain.removeHandler(PlatformChannels.ListSessionSharingPeerSessions);
    ipcMain.removeHandler(PlatformChannels.PreviewSessionSharingPeerSession);
    ipcMain.removeHandler(PlatformChannels.ImportSessionSharingPeerSession);
    ipcMain.removeHandler(PlatformChannels.CloseSessionSharingPeer);
  };
}
