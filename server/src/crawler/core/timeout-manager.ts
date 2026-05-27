import { Page } from "playwright";
import { Logger } from "../logging/logger.js";

export type RecoveryStrategy = (page: Page, log: Logger) => Promise<boolean>;

export class TimeoutManager {
  private page: Page;
  private log: Logger;
  private lastActive = Date.now();
  private timer?: NodeJS.Timeout;
  private timeoutMs: number;
  private strategies: RecoveryStrategy[];
  private maxRetries: number;
  private currentRetries: number;
  private isRecovering: boolean;
  private isDisposed = false;

  constructor(
    page: Page,
    log: Logger,
    timeoutMs = 60_000,
    strategies: RecoveryStrategy[] = [],
    maxRetries = 3
  ) {
    this.page = page;
    this.log = log;
    this.timeoutMs = timeoutMs;
    this.strategies = strategies;
    this.maxRetries = maxRetries;
    this.currentRetries = 0;
    this.isRecovering = false;
    this.install();
  }

  private install() {
    const touch = () => {
      this.lastActive = Date.now();
    };
    this.page.on("request", touch);
    this.page.on("response", touch);
    this.page.on("load", touch);
    this.page.on("framenavigated", touch);
    this.timer = setInterval(
      () => this.watchdog(),
      Math.min(5_000, this.timeoutMs / 2)
    );
  }

  private async watchdog() {
    // dispose 됐거나 페이지가 죽었으면 어떤 복구도 시도하지 않는다
    if (this.isDisposed) return;
    try {
      if (this.page.isClosed()) {
        this.dispose();
        return;
      }
    } catch {
      this.dispose();
      return;
    }

    if (Date.now() - this.lastActive < this.timeoutMs) return;

    this.log.warn("timeout-manager.trigger");

    // 기존 전략들 시도
    for (const strat of this.strategies) {
      try {
        const ok = await strat(this.page, this.log);
        if (ok) {
          this.bump("recovered");
          return;
        }
      } catch (e) {
        this.log.error({ e }, "timeout.strategy.error");
      }
    }

    // 고급 복구 전략 시도
    await this.attemptAdvancedRecovery();
  }

  private async attemptAdvancedRecovery() {
    if (this.isRecovering) return;
    if (this.currentRetries >= this.maxRetries) {
      this.log.error("MAX_RETRIES_EXCEEDED");
      this.bump("unrecovered");
      return;
    }

    this.isRecovering = true;
    this.currentRetries++;

    try {
      this.log.warn(
        `🔄 Advanced recovery attempt ${this.currentRetries}/${this.maxRetries}`
      );

      // 복구 방법 선택
      if (this.currentRetries === 1) {
        await this.refreshPage();
      } else if (this.currentRetries === 2) {
        await this.researchAndNavigate();
      } else {
        await this.forceNextPage();
      }

      this.updateActivity();
      this.isRecovering = false;
      this.log.info("✅ Advanced recovery successful");
    } catch (error) {
      this.log.error({ error }, "Advanced recovery failed");
      this.isRecovering = false;
      // 죽은 페이지에 waitForTimeout 호출하면 uncaught throw 가 나서 프로세스가 죽는다.
      try {
        if (!this.page.isClosed()) {
          await this.page.waitForTimeout(5000);
        }
      } catch {}
    }
  }

  private async refreshPage() {
    this.log.warn("strategy.refresh-page");
    await this.page.reload({ waitUntil: "domcontentloaded" });
    await this.page.waitForTimeout(8000);
  }

  private async researchAndNavigate() {
    this.log.warn("strategy.research-navigate");

    try {
      // 검색창 찾기 및 검색 실행 (strict mode 회피 위해 visible 첫 요소만 사용)
      const keyword = process.env.SEARCH_KEYWORD || "꽃집";
      const searchBox = await this.page
        .locator("input.input_search:visible")
        .first()
        .elementHandle({ timeout: 15000 });
      if (!searchBox) throw new Error("Search box not found");
      await searchBox.fill(keyword);
      await this.page.keyboard.press("Enter");

      // 검색 결과 로딩 대기
      await this.page.waitForTimeout(8000);
    } catch (error) {
      this.log.error({ error }, "Research and navigate failed");
    }
  }

  private async forceNextPage() {
    this.log.warn("strategy.force-next-page");

    try {
      // 강제로 다음 페이지로 이동 시도
      const nextPageResult = await this.goToNextPage();
      if (nextPageResult) {
        this.log.info("✅ Forced next page navigation successful");
      }
    } catch (error) {
      this.log.error({ error }, "Force next page failed");
    }
  }

  private async goToNextPage(): Promise<boolean> {
    try {
      // 검색 결과 iframe 찾기
      const searchFrame = await this.findSearchFrame();
      if (!searchFrame) return false;

      // 다음 페이지 버튼 찾기
      const nextPageButton = await searchFrame.$('a:has-text("다음페이지")');
      if (nextPageButton) {
        await nextPageButton.click();
        await this.page.waitForTimeout(5000);
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  private async findSearchFrame() {
    try {
      const frames = this.page.frames();
      for (const frame of frames) {
        const url = frame.url();
        if (
          url.includes("pcmap.place.naver.com/place/list") ||
          url.includes("pcmap.place.naver.com/lashshop/list")
        ) {
          return frame;
        }
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  private updateActivity() {
    this.lastActive = Date.now();
    this.currentRetries = 0; // 활동이 있으면 재시도 횟수 리셋
  }

  private bump(tag: string) {
    this.lastActive = Date.now();
    this.log.warn({ tag }, "timeout-manager.bump");
  }

  dispose() {
    this.isDisposed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}

// Built-in strategies
export const reloadPage: RecoveryStrategy = async (page, log) => {
  log.warn("strategy.reload");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  return true;
};

export const goBackThenForward: RecoveryStrategy = async (page, log) => {
  log.warn("strategy.back-forward");
  await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(600);
  await page.goForward({ waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(600);
  return true;
};
