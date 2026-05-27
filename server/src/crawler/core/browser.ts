import {
  chromium,
  Browser,
  BrowserContext,
  Page,
  LaunchOptions,
} from "playwright";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../../config.js";
import type { Logger } from "../logging/logger.js";

function findChromiumExecutable(browsersRoot: string): string | undefined {
  if (!existsSync(browsersRoot)) return undefined;

  let chromiumDir: string | undefined;
  try {
    chromiumDir = readdirSync(browsersRoot).find((e) => e.startsWith("chromium-"));
  } catch {
    return undefined;
  }
  if (!chromiumDir) return undefined;

  const versionedDir = join(browsersRoot, chromiumDir);
  let exe: string;
  switch (process.platform) {
    case "win32":
      exe = join(versionedDir, "chrome-win64", "chrome.exe");
      if (!existsSync(exe)) {
        const alt = join(versionedDir, "chrome-win", "chrome.exe");
        if (existsSync(alt)) exe = alt;
      }
      break;
    case "darwin":
      exe = join(versionedDir, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium");
      break;
    default:
      exe = join(versionedDir, "chrome-linux", "chrome");
  }

  return existsSync(exe) ? exe : undefined;
}

async function ensureChromium(log: Logger): Promise<string | undefined> {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!browsersRoot) {
    log.info("PLAYWRIGHT_BROWSERS_PATH 미설정 — Playwright 기본 경로 사용");
    return undefined;
  }

  const existing = findChromiumExecutable(browsersRoot);
  if (existing) {
    log.info({ exePath: existing }, "✅ 기존 Chromium 사용");
    return existing;
  }

  log.warn({ browsersRoot }, "⚠️ Chromium 미설치 — postinstall에서 설치되어야 합니다");
  mkdirSync(browsersRoot, { recursive: true });
  return undefined;
}

export interface BrowserController {
  launch(): Promise<void>;
  newContext(): Promise<BrowserContext>;
  newPage(): Promise<Page>;
  restart(reason: string): Promise<void>;
  close(): Promise<void>;
}

export interface BrowserControllerOptions {
  headful: boolean;
  slowMo: number;
  log: Logger;
  persistent?: boolean;
  userDataDir?: string;
}

const DEFAULT_LAUNCH_ARGS = [
  "--disable-features=site-per-process",
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-web-security",
  "--disable-features=VizDisplayCompositor",
];

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36";

export class PlaywrightController implements BrowserController {
  private browser?: Browser;
  private persistentContext?: BrowserContext;
  private opts: Required<BrowserControllerOptions>;
  private maxRestarts = 5;
  private currentRestarts = 0;
  private restartDelay = 10000;

  constructor(opts: BrowserControllerOptions) {
    this.opts = {
      headful: opts.headful,
      slowMo: opts.slowMo,
      log: opts.log,
      persistent: opts.persistent ?? true,
      userDataDir: opts.userDataDir ?? join(config.dataDir, "playwright-profile"),
    };
  }

  async launch() {
    if (this.persistentContext || this.browser) return;
    const executablePath = await ensureChromium(this.opts.log);

    if (this.opts.persistent) {
      mkdirSync(this.opts.userDataDir, { recursive: true });
      this.persistentContext = await chromium.launchPersistentContext(
        this.opts.userDataDir,
        {
          headless: !this.opts.headful,
          slowMo: this.opts.slowMo,
          args: DEFAULT_LAUNCH_ARGS,
          viewport: { width: 1400, height: 900 },
          userAgent: DEFAULT_USER_AGENT,
          ...(executablePath ? { executablePath } : {}),
        }
      );
      this.opts.log.info({ userDataDir: this.opts.userDataDir }, "browser.launchPersistent");
    } else {
      const launchOpts: LaunchOptions = {
        headless: !this.opts.headful,
        slowMo: this.opts.slowMo,
        args: DEFAULT_LAUNCH_ARGS,
        ...(executablePath ? { executablePath } : {}),
      };
      this.browser = await chromium.launch(launchOpts);
      this.opts.log.info("browser.launch");
    }
  }

  async newContext(): Promise<BrowserContext> {
    if (this.opts.persistent) {
      if (!this.persistentContext) await this.launch();
      return this.persistentContext!;
    }
    if (!this.browser) await this.launch();
    return await this.browser!.newContext({
      viewport: { width: 1400, height: 900 },
      userAgent: DEFAULT_USER_AGENT,
    });
  }

  async newPage(): Promise<Page> {
    const ctx = await this.newContext();
    const page = await ctx.newPage();
    page.on("crash", () => this.opts.log.warn("page.crash"));
    page.on("console", (msg) =>
      this.opts.log.debug({ type: msg.type(), text: msg.text() }, "page.console")
    );
    return page;
  }

  async restart(reason: string) {
    this.opts.log.warn({ reason }, "browser.restart");
    if (this.currentRestarts >= this.maxRestarts) {
      throw new Error("MAX_BROWSER_RESTARTS_EXCEEDED");
    }
    this.currentRestarts++;
    await this.close();
    await new Promise((r) => setTimeout(r, this.restartDelay));
    await this.launch();
    this.currentRestarts = 0;
  }

  async close() {
    if (this.persistentContext) {
      try { await this.persistentContext.close(); } catch { /* ignore */ }
      this.persistentContext = undefined;
    }
    if (this.browser) {
      try { await this.browser.close(); } catch { /* ignore */ }
      this.browser = undefined;
    }
  }
}
