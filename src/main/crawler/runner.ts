import type { Page } from "playwright";
import { PlaywrightController } from "./core/browser.js";
import {
  TimeoutManager,
  reloadPage,
  goBackThenForward,
} from "./core/timeout-manager.js";
import { runSearch } from "./naver/map.search.js";
import {
  collectListItems,
  clickListItem,
  goToNextPage,
  goToSpecificPage,
  getCurrentPageNumber,
} from "./naver/map.list.js";
import { extractDetail } from "./naver/map.detail.js";
import { findSearchFrameByUrl } from "./utils/selectors.js";
import { matchesCategory } from "./utils/category-match.js";
import type { Logger } from "./logging/logger.js";
import type { IPlaceRepo } from "./extractors/repository.js";
import { KOREA_CITIES } from "./config/korea-data.js";

export type CrawlMode = "single" | "all_korea";

export interface ResumeFrom {
  cityIndex?: number;
  districtIndex?: number;
  dongIndex?: number;
  page?: number;
  listIndex?: number;
}

export interface ProgressEvent {
  city: string;
  district: string;
  dong: string;
  cityIndex: number;
  districtIndex: number;
  dongIndex: number;
  page: number;
  listIndex: number;
  processed: number;
}

export interface CrawlSessionOptions {
  sessionId: string;
  mode: CrawlMode;
  keyword: string;
  /** 단일 모드일 때 사용 */
  city?: string;
  district?: string;
  dong?: string;
  headful: boolean;
  slowMo: number;
  resumeFrom?: ResumeFrom;
  placesRepo: IPlaceRepo;
  logger: Logger;
  onProgress: (e: ProgressEvent) => void;
  signal: AbortSignal;
}

const isFatalPageError = (msg: string) =>
  msg.includes("crash") ||
  msg.includes("Target closed") ||
  msg.includes("Target page, context or browser has been closed") ||
  msg.includes("has been closed");

interface ProcessOneArgs {
  city: string;
  district: string;
  dong: string;
  resumePage?: number;
  resumeListIndex?: number;
}

export class CrawlSession {
  private browser: PlaywrightController;
  private page?: Page;
  private timeout?: TimeoutManager;
  private processed = 0;
  private currentCity = "";
  private currentDistrict = "";
  private currentDong = "";
  private currentCityIndex = 0;
  private currentDistrictIndex = 0;
  private currentDongIndex = 0;
  private currentPage = 1;
  private currentListIndex = 0;
  private stopped = false;

  // 자동 중단 가드 카운터
  private consecutiveSaveFailures = 0;
  private consecutiveEmptyDongs = 0;
  private readonly MAX_CONSECUTIVE_SAVE_FAILURES = 10;
  private readonly MAX_CONSECUTIVE_EMPTY_DONGS = 5;

  constructor(private opts: CrawlSessionOptions) {
    this.browser = new PlaywrightController({
      headful: opts.headful,
      slowMo: opts.slowMo,
      log: opts.logger,
    });
    if (opts.mode === "single") {
      this.currentCity = opts.city ?? "";
      this.currentDistrict = opts.district ?? "";
      this.currentDong = opts.dong ?? "";
    }
  }

  getState() {
    return {
      city: this.currentCity,
      district: this.currentDistrict,
      dong: this.currentDong,
      cityIndex: this.currentCityIndex,
      districtIndex: this.currentDistrictIndex,
      dongIndex: this.currentDongIndex,
      page: this.currentPage,
      listIndex: this.currentListIndex,
      processed: this.processed,
    };
  }

  private async recreatePage(): Promise<void> {
    try {
      this.timeout?.dispose();
    } catch {
      /* ignore */
    }
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
      }
    } catch {
      /* ignore */
    }
    this.page = await this.browser.newPage();
    this.page.on("crash", () => this.handleCrash());
    this.timeout = new TimeoutManager(
      this.page,
      this.opts.logger,
      60_000,
      [reloadPage, goBackThenForward],
      3
    );
  }

  /**
   * 브라우저(Chromium 프로세스) 통째로 재시작 — 메모리 누수 회수.
   * recreatePage는 페이지만 새로 만들기 때문에 Chromium 자체의 누수는 못 잡음.
   * 매 동 처리 후 / fatal error 시 호출.
   */
  private async recycleBrowser(reason: string): Promise<void> {
    this.opts.logger.info({ reason }, "♻️ browser recycle");
    try {
      this.timeout?.dispose();
    } catch {
      /* ignore */
    }
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close({ runBeforeUnload: false });
      }
    } catch {
      /* ignore */
    }
    this.page = undefined;
    try {
      await this.browser.close();
    } catch {
      /* ignore */
    }
    // persistent context의 lock 파일 해제 + Chromium 프로세스 완전 종료 대기
    await new Promise((r) => setTimeout(r, 800));
    await this.browser.launch();
    await this.recreatePage();
    this.opts.logger.info("✅ browser recycled");
  }

  private async handleCrash(): Promise<void> {
    this.opts.logger.error("⚠️ page.crash detected");
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close({ runBeforeUnload: false });
      }
    } catch {
      /* ignore */
    }
  }

  private emitProgress() {
    this.opts.onProgress({
      city: this.currentCity,
      district: this.currentDistrict,
      dong: this.currentDong,
      cityIndex: this.currentCityIndex,
      districtIndex: this.currentDistrictIndex,
      dongIndex: this.currentDongIndex,
      page: this.currentPage,
      listIndex: this.currentListIndex,
      processed: this.processed,
    });
  }

  async start(): Promise<void> {
    const { signal, logger } = this.opts;
    signal.addEventListener("abort", () => {
      this.stopped = true;
      logger.warn("🛑 stop signal received");
    });

    await this.browser.launch();
    await this.recreatePage();

    try {
      if (this.opts.mode === "all_korea") {
        await this.runAllKorea();
      } else {
        await this.runSingle();
      }
    } finally {
      await this.dispose();
    }
  }

  private async runSingle(): Promise<void> {
    const city = this.opts.city ?? "";
    const district = this.opts.district ?? "";
    const dong = this.opts.dong ?? "";
    if (!city || !district || !dong) {
      throw new Error("단일 모드는 city/district/dong이 모두 필요합니다.");
    }
    await this.processOne({
      city,
      district,
      dong,
      resumePage: this.opts.resumeFrom?.page,
      resumeListIndex: this.opts.resumeFrom?.listIndex,
    });
  }

  private async runAllKorea(): Promise<void> {
    const { logger } = this.opts;
    const cities = Object.keys(KOREA_CITIES);
    const startCi = this.opts.resumeFrom?.cityIndex ?? 0;
    const startDi = this.opts.resumeFrom?.districtIndex ?? 0;
    const startDoi = this.opts.resumeFrom?.dongIndex ?? 0;

    logger.info(
      `🌐 전국 자동 순회 시작 (도시 ${cities.length}개, 시작: ${cities[startCi] ?? cities[0]})`
    );

    for (let ci = startCi; ci < cities.length && !this.stopped; ci++) {
      const city = cities[ci] as keyof typeof KOREA_CITIES;
      const districts = Object.keys(KOREA_CITIES[city]);
      this.currentCity = city;
      this.currentCityIndex = ci;

      for (
        let di = ci === startCi ? startDi : 0;
        di < districts.length && !this.stopped;
        di++
      ) {
        const district = districts[di];
        const dongs = (
          KOREA_CITIES[city] as Record<string, string[]>
        )[district];
        this.currentDistrict = district;
        this.currentDistrictIndex = di;

        for (
          let doi =
            ci === startCi && di === startDi ? startDoi : 0;
          doi < dongs.length && !this.stopped;
          doi++
        ) {
          const dong = dongs[doi];
          this.currentDong = dong;
          this.currentDongIndex = doi;

          const isResumeOrigin =
            ci === startCi && di === startDi && doi === startDoi;

          try {
            await this.processOne({
              city,
              district,
              dong,
              resumePage: isResumeOrigin
                ? this.opts.resumeFrom?.page
                : undefined,
              resumeListIndex: isResumeOrigin
                ? this.opts.resumeFrom?.listIndex
                : undefined,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // CRAWL_ABORT는 임계치 도달 시 자동 중단 신호 → 즉시 세션 전체 종료
            if (msg.startsWith("CRAWL_ABORT:")) {
              logger.fatal(`🛑 ${msg}`);
              throw err;
            }
            logger.error(
              { error: msg },
              `❌ ${city} ${district} ${dong} 처리 실패`
            );
            if (isFatalPageError(msg)) {
              await this.recycleBrowser("fatal error in dong loop").catch(
                () => {}
              );
            }
          }

          if (this.stopped || this.opts.signal.aborted) break;

          // 메모리 누수 회수: 동 단위로 Chromium 프로세스 통째 재시작
          try {
            await this.recycleBrowser(`완료: ${city} ${district} ${dong}`);
          } catch (e) {
            logger.error(
              { error: e instanceof Error ? e.message : String(e) },
              "browser recycle 실패"
            );
          }
        }
      }
    }

    if (!this.stopped) {
      this.opts.logger.info("🎉 전국 자동 순회 완료");
    }
  }

  private async processOne(args: ProcessOneArgs): Promise<void> {
    const { logger, placesRepo, signal, keyword } = this.opts;
    const { city, district, dong, resumePage, resumeListIndex } = args;
    if (!this.page) throw new Error("page not initialized");

    this.currentPage = 1;
    this.currentListIndex = 0;
    const processedAtStart = this.processed;

    logger.info(`🎯 ${city} ${district} ${dong} (keyword: ${keyword}) 처리 시작`);

    await runSearch(this.page, `${district} ${dong} ${keyword}`, logger);

    let startListIndex = 0;
    if (resumePage && resumePage > 1) {
      this.currentPage = resumePage;
      logger.info(`🔄 페이지 ${resumePage}로 점프 시도`);
      const moved = await goToSpecificPage(this.page, resumePage, logger);
      if (!moved) {
        logger.warn("⚠️ 페이지 점프 실패, 1페이지부터 시작");
        this.currentPage = 1;
      } else {
        startListIndex = resumeListIndex ?? 0;
      }
    }
    this.emitProgress();

    let firstIteration = true;
    while (!this.stopped) {
      if (signal.aborted) break;

      const items = await collectListItems(this.page, logger);
      if (items.length === 0) {
        logger.warn(`No items in page ${this.currentPage}`);
        break;
      }

      logger.info(
        `Page ${this.currentPage}: ${items.length}건 항목, ${
          firstIteration ? startListIndex : 0
        } 부터 처리`
      );

      for (
        let i = firstIteration ? startListIndex : 0;
        i < items.length;
        i++
      ) {
        if (signal.aborted || this.stopped) break;
        this.currentListIndex = i;
        const item = items[i];
        if (!item.name || item.name.trim().length === 0) {
          logger.warn(`Skipping item ${i}: invalid name`);
          continue;
        }

        // 클릭 전 카테고리 매칭 체크: 검색 키워드와 무관한 업종이면 skip.
        // 카테고리가 없으면(undefined) 일단 통과시켜 detail 단계로 진행.
        if (!matchesCategory(keyword, item.category)) {
          logger.info(
            `🚫 카테고리 미스매치 skip: "${item.name}" [${item.category}] (keyword="${keyword}")`
          );
          continue;
        }

        try {
          const sf = await findSearchFrameByUrl(this.page);
          if (sf) {
            const actual = await getCurrentPageNumber(sf, logger);
            if (actual !== this.currentPage) {
              logger.warn(
                `⚠️ page mismatch: ${this.currentPage} → ${actual}, recovering`
              );
              const ok = await goToSpecificPage(
                this.page,
                this.currentPage,
                logger
              );
              if (!ok) this.currentPage = actual;
            }
          }
        } catch (err) {
          logger.warn(
            `page sanity check failed: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }

        if (!(await clickListItem(this.page, i, logger))) {
          logger.warn(`⚠️ click failed for ${i}th item`);
          continue;
        }

        try {
          const detail = await extractDetail(
            this.page,
            {
              city,
              district,
              dong,
              pageNo: this.currentPage,
              listIndex: i,
              shopName: item.name,
            },
            logger
          );
          await placesRepo.upsert({
            ...detail,
            naver_search: `${district} ${dong} ${keyword}`,
          });
          this.processed += 1;
          this.consecutiveSaveFailures = 0;
          this.emitProgress();
          logger.info(
            `💾 저장 (#${this.processed}): ${detail.shop_name} · ${
              detail.address ?? "주소 없음"
            }`
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.consecutiveSaveFailures += 1;
          logger.error(
            `❌ ${i}번째 item 저장 실패 (연속 ${this.consecutiveSaveFailures}/${this.MAX_CONSECUTIVE_SAVE_FAILURES}): ${msg}`
          );
          if (
            this.consecutiveSaveFailures >= this.MAX_CONSECUTIVE_SAVE_FAILURES
          ) {
            throw new Error(
              `CRAWL_ABORT: 저장이 ${this.MAX_CONSECUTIVE_SAVE_FAILURES}회 연속 실패 — 세션 자동 종료 (마지막 에러: ${msg})`
            );
          }
          if (isFatalPageError(msg)) {
            logger.warn("🔄 Fatal error, browser 통째 재시작...");
            await this.recycleBrowser("fatal during item processing").catch(
              () => {}
            );
            try {
              if (this.page)
                await runSearch(
                  this.page,
                  `${district} ${dong} ${keyword}`,
                  logger
                );
              if (this.page && this.currentPage > 1) {
                await goToSpecificPage(this.page, this.currentPage, logger);
              }
            } catch {
              /* ignore */
            }
            continue;
          }
        }
      }

      firstIteration = false;
      if (signal.aborted || this.stopped) break;

      logger.info(`✅ Page ${this.currentPage} 완료, 다음 페이지로`);
      this.currentPage += 1;
      this.currentListIndex = 0;
      this.emitProgress();

      const moved = await goToNextPage(this.page, logger);
      if (!moved) {
        logger.info("📌 더 이상 페이지가 없음");
        break;
      }
      await this.page.waitForTimeout(800);
    }

    // 이 동에서 한 건도 저장 못 했으면 연속 빈 동 카운터 증가
    const savedInThisDong = this.processed - processedAtStart;
    if (savedInThisDong === 0) {
      this.consecutiveEmptyDongs += 1;
      logger.warn(
        `🪹 ${city} ${district} ${dong}에서 저장 0건 (연속 빈 동 ${this.consecutiveEmptyDongs}/${this.MAX_CONSECUTIVE_EMPTY_DONGS})`
      );
      if (this.consecutiveEmptyDongs >= this.MAX_CONSECUTIVE_EMPTY_DONGS) {
        throw new Error(
          `CRAWL_ABORT: ${this.MAX_CONSECUTIVE_EMPTY_DONGS}개 동 연속 저장 0건 — 차단/봇감지 의심, 세션 자동 종료`
        );
      }
    } else {
      this.consecutiveEmptyDongs = 0;
    }

    logger.info(
      this.stopped
        ? `🛑 중지됨 (${city} ${district} ${dong} page=${this.currentPage}, idx=${this.currentListIndex})`
        : `✅ ${city} ${district} ${dong} 완료 (이 동에서 ${savedInThisDong}건, 누적 ${this.processed}건)`
    );
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  async dispose(): Promise<void> {
    try {
      this.timeout?.dispose();
    } catch {
      /* ignore */
    }
    try {
      await this.browser.close();
    } catch {
      /* ignore */
    }
  }
}
