import { app, ipcMain } from "electron";
import {
  checkForUpdatesManually,
  getLastUpdateStatus,
  quitAndInstall,
} from "../updater.js";

export function registerUpdaterIpc() {
  ipcMain.handle("updater:check", async () => {
    return checkForUpdatesManually();
  });
  ipcMain.handle("updater:status", () => {
    return getLastUpdateStatus();
  });
  ipcMain.handle("updater:quitAndInstall", () => {
    quitAndInstall();
  });
  ipcMain.handle("updater:appVersion", () => {
    return app.getVersion();
  });
}
