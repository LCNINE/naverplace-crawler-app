import {
  chromium,
  Browser,
  BrowserContext,
  Page,
  LaunchOptions,
} from "playwright";
import { app } from "electron";
import { join } from "node:path";
import type { Logger } from "../logging/logger.js";

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

    if (this.opts.persistent) {
      this.persistentContext = await chromium.launchPersistentContext(
        this.opts.userDataDir,
        {
          headless: !this.opts.headful,
          slowMo: this.opts.slowMo,
          args: launchArgs,
          viewport: { width: 1400, height: 900 },
          userAgent: DEFAULT_USER_AGENT,
        }
      );
      this.opts.log.info(
        { userDataDir: this.opts.userDataDir },
        "browser.launchPersistent"
      );
    } else {
      const launchOpts: LaunchOptions = {
        headless: !this.opts.headful,
        slowMo: this.opts.slowMo,
        args: launchArgs,
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
