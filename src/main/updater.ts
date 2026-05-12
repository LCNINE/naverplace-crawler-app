import { app, dialog, BrowserWindow } from "electron";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

export type UpdateStatus =
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "not-available"; version: string }
  | { type: "downloading"; percent: number; bytesPerSecond: number }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string };

let initialized = false;
let lastStatus: UpdateStatus | null = null;

function send(window: BrowserWindow, status: UpdateStatus) {
  lastStatus = status;
  if (window.isDestroyed()) return;
  window.webContents.send("updater:status", status);
}

export function getLastUpdateStatus(): UpdateStatus | null {
  return lastStatus;
}

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  if (initialized) return;
  initialized = true;

  if (!app.isPackaged) {
    // dev 모드에선 동작하지 않음 (electron-updater는 packaged 앱 전용)
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("checking-for-update", () => {
    send(mainWindow, { type: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    send(mainWindow, { type: "available", version: info.version });
  });

  autoUpdater.on("update-not-available", (info) => {
    send(mainWindow, { type: "not-available", version: info.version });
  });

  autoUpdater.on("download-progress", (progress) => {
    send(mainWindow, {
      type: "downloading",
      percent: Math.round(progress.percent),
      bytesPerSecond: Math.round(progress.bytesPerSecond),
    });
  });

  autoUpdater.on("update-downloaded", async (info) => {
    send(mainWindow, { type: "downloaded", version: info.version });
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["지금 재시작", "나중에"],
      defaultId: 0,
      cancelId: 1,
      title: "업데이트 준비 완료",
      message: `v${info.version} 업데이트가 다운로드되었습니다.`,
      detail: "지금 재시작하면 새 버전이 적용됩니다. 닫으면 다음 실행 시 자동 적용됩니다.",
    });
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on("error", (err) => {
    send(mainWindow, {
      type: "error",
      message: err?.message ?? String(err),
    });
  });

  // 앱 부팅 후 5초 뒤 첫 체크 (네트워크/창 준비 시간 확보)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      /* error 이벤트로 전달됨 */
    });
  }, 5000);

  // 6시간마다 재체크
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {
      /* ignore */
    });
  }, 6 * 60 * 60 * 1000);
}

export async function checkForUpdatesManually(): Promise<UpdateStatus | null> {
  if (!app.isPackaged) {
    return { type: "not-available", version: app.getVersion() };
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    return {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  return lastStatus;
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall();
}
