import {
  chromium,
  Browser,
  BrowserContext,
  Page,
  LaunchOptions,
} from "playwright";
import { app } from "electron";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Logger } from "../logging/logger.js";

/**
 * 사용자 환경의 Chromium 실행 파일 경로를 찾는다.
 * `PLAYWRIGHT_BROWSERS_PATH/chromium-XXXX/<platform>/...` 구조.
 */
function findChromiumExecutable(browsersRoot: string): string | undefined {
  if (!existsSync(browsersRoot)) return undefined;

  let chromiumDir: string | undefined;
  try {
    chromiumDir = readdirSync(browsersRoot).find((e) =>
      e.startsWith("chromium-")
    );
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
      exe = join(
        versionedDir,
        "chrome-mac",
        "Chromium.app",
        "Contents",
        "MacOS",
        "Chromium"
      );
      break;
    default:
      exe = join(versionedDir, "chrome-linux", "chrome");
  }

  return existsSync(exe) ? exe : undefined;
}

/**
 * Playwright CLI 를 ELECTRON_RUN_AS_NODE 모드로 실행해 chromium 을 다운로드한다.
 * Electron 바이너리를 순수 node 처럼 사용하므로 외부 node/npm 설치 불필요.
 */
function spawnPlaywrightInstall(
  browsersRoot: string,
  log: Logger
): Promise<void> {
  return new Promise((resolve, reject) => {
    let cliPath: string;
    try {
      const req = createRequire(import.meta.url);
      // playwright 의 package.json exports 필드에 './cli' 가 등록되어 있지 않아
      // require.resolve('playwright/cli') 는 ERR_PACKAGE_PATH_NOT_EXPORTED 로 실패함.
      // package.json 은 exports 에 등록되어 있으니 그걸로 패키지 루트를 잡고 cli.js 를 직접 가리킨다.
      const pkgJsonPath = req.resolve("playwright/package.json");
      cliPath = join(dirname(pkgJsonPath), "cli.js");
      if (!existsSync(cliPath)) {
        throw new Error(`playwright cli.js not found at ${cliPath}`);
      }
    } catch (e) {
      reject(
        new Error(
          `playwright CLI 경로 해석 실패: ${e instanceof Error ? e.message : String(e)}`
        )
      );
      return;
    }

    log.info({ cliPath, browsersRoot }, "▶ playwright install chromium 시작");

    const child = spawn(process.execPath, [cliPath, "install", "chromium"], {
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: browsersRoot,
        ELECTRON_RUN_AS_NODE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (d: Buffer) => {
      const text = d.toString().trim();
      if (text) log.info({ stdout: text }, "playwright install");
    });
    child.stderr?.on("data", (d: Buffer) => {
      const text = d.toString().trim();
      if (text) log.warn({ stderr: text }, "playwright install");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`playwright install exited with code ${code}`));
    });
  });
}

/**
 * Chromium 이 설치되어 있으면 경로 반환, 없으면 다운로드 후 경로 반환.
 * - dev 모드: PLAYWRIGHT_BROWSERS_PATH 미설정이면 default 경로(`~/.cache/ms-playwright`) 사용
 * - packaged: userData/playwright-browsers 에 설치
 *
 * 다운로드 시 electron-progressbar 로 indeterminate UI 를 띄워 사용자에게 알림.
 */
async function ensureChromium(log: Logger): Promise<string | undefined> {
  const browsersRoot =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    (app.isPackaged
      ? join(app.getPath("userData"), "playwright-browsers")
      : undefined);

  // dev 환경 + env 미설정이면 Playwright 의 기본 동작에 맡김 (executablePath 미지정)
  if (!browsersRoot) return undefined;

  // 경로 강제 동기화 — 호출 시점에 한 번 더 보장
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersRoot;

  const existing = findChromiumExecutable(browsersRoot);
  if (existing) {
    log.info({ exePath: existing }, "✅ 기존 Chromium 사용");
    return existing;
  }

  log.warn({ browsersRoot }, "⚠️ Chromium 미설치 — 다운로드 시작");
  mkdirSync(browsersRoot, { recursive: true });

  // electron-progressbar는 CJS 모듈이라 ESM top-level import 시 메인 프로세스가
  // 깨질 수 있어 다운로드 직전에만 dynamic import로 로드한다.
  // dev 모드는 PLAYWRIGHT_BROWSERS_PATH 미설정 → 이 함수에 진입조차 안 하므로 영향 없음.
  type ProgressBarCtor = new (opts: Record<string, unknown>) => {
    setCompleted: () => void;
    close: () => void;
  };
  let progressBar: InstanceType<ProgressBarCtor> | null = null;
  try {
    const mod = (await import("electron-progressbar")) as {
      default?: ProgressBarCtor;
    };
    const ProgressBar = (mod.default ??
      (mod as unknown as ProgressBarCtor)) as ProgressBarCtor;
    progressBar = new ProgressBar({
      indeterminate: true,
      text: "Chromium 다운로드 중...",
      detail:
        "첫 실행에 필요한 브라우저(약 150MB)를 받고 있습니다. 잠시만 기다려 주세요.",
      closeOnComplete: true,
      browserWindow: {
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      },
    });
  } catch (e) {
    log.warn(
      { error: e instanceof Error ? e.message : String(e) },
      "⚠️ ProgressBar UI 로드 실패 — UI 없이 다운로드 진행"
    );
  }

  try {
    await spawnPlaywrightInstall(browsersRoot, log);
  } catch (e) {
    progressBar?.close();
    log.error(
      { error: e instanceof Error ? e.message : String(e) },
      "❌ Chromium 다운로드 실패"
    );
    throw e;
  }

  try {
    progressBar?.setCompleted();
  } catch {
    /* ignore */
  }

  const exePath = findChromiumExecutable(browsersRoot);
  if (!exePath) {
    log.error(
      { browsersRoot },
      "❌ 다운로드 후에도 Chromium 실행 파일을 찾지 못함"
    );
    return undefined;
  }
  log.info({ exePath }, "✅ Chromium 다운로드 완료");
  return exePath;
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
  /**
   * Persistent context를 사용할지 여부.
   * true이면 user-data-dir에 쿠키/스토리지가 저장되어 재실행 시 재사용됨.
   * 기본 true.
   */
  persistent?: boolean;
  /** persistent context의 user-data-dir. 기본: userData/playwright-profile */
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
  private maxRestarts: number;
  private currentRestarts: number;
  private restartDelay: number;

  constructor(opts: BrowserControllerOptions) {
    this.opts = {
      headful: opts.headful,
      slowMo: opts.slowMo,
      log: opts.log,
      persistent: opts.persistent ?? true,
      userDataDir:
        opts.userDataDir ?? join(app.getPath("userData"), "playwright-profile"),
    };
    this.maxRestarts = 5;
    this.currentRestarts = 0;
    this.restartDelay = 10000;
  }

  async launch() {
    if (this.persistentContext || this.browser) return;
    const launchArgs = DEFAULT_LAUNCH_ARGS;
    const executablePath = await ensureChromium(this.opts.log);

    if (this.opts.persistent) {
      this.persistentContext = await chromium.launchPersistentContext(
        this.opts.userDataDir,
        {
          headless: !this.opts.headful,
          slowMo: this.opts.slowMo,
          args: launchArgs,
          viewport: { width: 1400, height: 900 },
          userAgent: DEFAULT_USER_AGENT,
          ...(executablePath ? { executablePath } : {}),
        }
      );
      this.opts.log.info(
        { userDataDir: this.opts.userDataDir, executablePath },
        "browser.launchPersistent"
      );
    } else {
      const launchOpts: LaunchOptions = {
        headless: !this.opts.headful,
        slowMo: this.opts.slowMo,
        args: launchArgs,
        ...(executablePath ? { executablePath } : {}),
      };
      this.browser = await chromium.launch(launchOpts);
      this.opts.log.info({ executablePath }, "browser.launch");
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
      this.opts.log.debug(
        { type: msg.type(), text: msg.text() },
        "page.console"
      )
    );
    return page;
  }

  async restart(reason: string) {
    this.opts.log.warn({ reason }, "browser.restart");

    if (this.currentRestarts >= this.maxRestarts) {
      this.opts.log.error(
        `MAX_BROWSER_RESTARTS_EXCEEDED (${this.maxRestarts}회)`
      );
      throw new Error("MAX_BROWSER_RESTARTS_EXCEEDED");
    }

    this.currentRestarts++;
    this.opts.log.warn(
      `🔄 브라우저 재시작 시도 ${this.currentRestarts}/${this.maxRestarts}...`
    );

    try {
      await this.close();
      await new Promise((resolve) => setTimeout(resolve, this.restartDelay));
      await this.launch();
      this.opts.log.info("✅ 브라우저 재시작 완료");
      this.resetRestartCount();
    } catch (error) {
      this.opts.log.error({ error }, "브라우저 재시작 실패");
      throw error;
    }
  }

  async close() {
    if (this.persistentContext) {
      try {
        await this.persistentContext.close();
      } catch {
        /* ignore */
      }
      this.persistentContext = undefined;
    }
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        /* ignore */
      }
      this.browser = undefined;
    }
  }

  resetRestartCount() {
    this.currentRestarts = 0;
  }

  getRestartCount(): number {
    return this.currentRestarts;
  }

  setMaxRestarts(max: number) {
    this.maxRestarts = max;
  }
}
