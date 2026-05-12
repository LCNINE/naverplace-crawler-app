import type { BrowserWindow } from "electron";
import { registerSecretsIpc } from "./secrets.js";
import { registerProgressIpc } from "./progress.js";
import { registerCrawlerIpc, stopAllSessions } from "./crawler.js";
import { registerPrefsIpc } from "./prefs.js";
import { registerAuthIpc } from "./auth.js";

export function registerIpc(mainWindow: BrowserWindow) {
  registerAuthIpc();
  registerSecretsIpc();
  registerProgressIpc();
  registerCrawlerIpc(mainWindow);
  registerPrefsIpc();
}

export { stopAllSessions };
