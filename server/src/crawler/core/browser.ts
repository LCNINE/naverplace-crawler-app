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

// 이미지/미디어/폰트 차단 토글. 기본 OFF.
// 차단을 켜면 일부 페이지(특히 안심번호 '전화번호 보기' 위젯)가 렌더되지 않아
// 전화번호를 놓친다. 프록시 대역폭 절감이 필요할 때만 BLOCK_IMAGES=true 로 켠다.
const BLOCK_RESOURCES = process.env.BLOCK_IMAGES === "true";

const DEFAULT_LAUNCH_ARGS = [
  "--disable-features=site-per-process",
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-web-security",
  "--disable-features=VizDisplayCompositor",
  // navigator.webdriver=true 및 자동화 배너를 제거 — 네이버 봇 탐지 회피의 핵심.
  "--disable-blink-features=AutomationControlled",
  ...(BLOCK_RESOURCES
    ? ["--blink-settings=imagesEnabled=false", "--disable-background-networking"]
    : []),
];

// 실제 크롬과 동일한 형식의 UA. 기존 값은 "Chrome Safari" 처럼 버전 번호가 빠져 있어
// 그 자체로 봇 신호였다. Chromium 메이저 버전에 맞춰 주기적으로 갱신할 것.
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DEFAULT_LOCALE = "ko-KR";
const DEFAULT_TIMEZONE = "Asia/Seoul";

// 신규 페이지마다 주입해 자동화 흔적을 지운다. webdriver 플래그, languages,
// plugins, window.chrome 등 headless/Playwright 가 남기는 대표적인 fingerprint 를 보정.
const STEALTH_INIT_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  if (!window.chrome) { window.chrome = { runtime: {} }; }
  const _origQuery = window.navigator.permissions && window.navigator.permissions.query;
  if (_origQuery) {
    window.navigator.permissions.query = (params) =>
      params && params.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : _origQuery(params);
  }
`;

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
      persistent: opts.persistent ?? false,
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
          locale: DEFAULT_LOCALE,
          timezoneId: DEFAULT_TIMEZONE,
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
      locale: DEFAULT_LOCALE,
      timezoneId: DEFAULT_TIMEZONE,
    });
  }

  async newPage(): Promise<Page> {
    const ctx = await this.newContext();
    const page = await ctx.newPage();
    await page.addInitScript(STEALTH_INIT_SCRIPT);
    // 리소스 차단은 기본 OFF (BLOCK_IMAGES=true 일 때만). 일부 페이지의 전화번호 위젯이
    // 렌더되지 않는 문제가 있어, 전화번호 수집을 우선해 기본은 차단하지 않는다.
    if (BLOCK_RESOURCES) {
      await page.route("**/*", (route) => {
        const type = route.request().resourceType();
        if (type === "image" || type === "media" || type === "font") {
          return route.abort();
        }
        return route.continue();
      });
    }
    page.on("crash", () => this.opts.log.warn("page.crash"));
    page.on("console", (msg) => {
      const text = msg.text();
      if (
        text.includes("Permissions policy violation") ||
        text.includes("blocked by permissions policy") ||
        text.includes("GPU stall due to ReadPixels") ||
        text.includes("Failed to load resource")
      ) return;
      this.opts.log.debug({ type: msg.type(), text }, "page.console");
    });
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
