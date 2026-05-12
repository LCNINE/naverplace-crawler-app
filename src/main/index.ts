import { app, BrowserWindow, shell } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { registerIpc, stopAllSessions } from "./ipc/index.js";
import { setLogTarget } from "./logger.js";
import { getProgressRepo } from "./storage/progress.repo.js";
import { initAutoUpdater } from "./updater.js";

// __dirname polyfill for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Packaged 환경에서 Playwright 브라우저 경로 지정
if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = join(
    process.resourcesPath,
    "playwright-browsers"
  );
}

// 메인 윈도우 핸들
let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#0b1220",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });

  // 외부 링크는 시스템 브라우저로
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  setLogTarget(mainWindow);
  registerIpc(mainWindow);
  initAutoUpdater(mainWindow);
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let quitting = false;
app.on("before-quit", async (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  try {
    await stopAllSessions();
  } catch {
    /* ignore */
  }
  try {
    getProgressRepo().flushSync();
  } catch {
    /* ignore */
  }
  app.exit(0);
});

process.on("unhandledRejection", (reason) => {
  // 앱 크래시를 막기 위해 로깅만
  console.error(
    "unhandledRejection:",
    reason instanceof Error ? reason.message : String(reason)
  );
});
