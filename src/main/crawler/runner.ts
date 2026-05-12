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
import { notifyChat } from "../notifier.js";
import type { Logger } from "./logging/logger.js";
import type { IPlaceRepo } from "./extractors/repository.js";
import { KOREA_CITIES } from "./config/korea-data.js";

// 자동 종료 / 알림 임계치
const MAX_CONSECUTIVE_SAVE_FAILURES = 10;  // 도달 시 세션 종료 + critical 알림
const ALERT_EMPTY_DONGS = 10;              // 알림만 (종료 X)
const ALERT_IFRAME_MISSING = 3;            // 알림만 (종료 X)

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
  /** 대표메뉴 수집 여부. 기본 true. false면 가게당 5~10초 절약. */
  collectMenu?: boolean;
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

  // 알림/자동종료 카운터
  private consecutiveSaveFailures = 0;
  private consecutiveEmptyDongs = 0;
  private consecutiveIframeMissing = 0;

  // "이미 알림 발송함" 플래그 — 한번 true 되면 세션 종료까지 sticky.
  // 자연 분포(시골/변두리 동) 에서도 임계 누적이 잦아 false positive 가 빈번하므로
  // 카테고리당 세션 1회만 알림. 사용자가 정지 후 다시 시작하면 새 세션이라 다시 알림 가능.
  private alertedEmptyDongs = false;
  private alertedIframeMissing = false;

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
            // CRAWL_ABORT 는 임계치 도달 시 자동 중단 신호 — 위에서 이미 webhook 보냈음
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
        // 1페이지에서 0건 = iframe 못 찾았거나 selector 깨짐 의심.
        // 단순히 그 동이 비어있을 수도 있어 즉시 알림은 보내지 않고 카운터만 증가,
        // 누적 N회면 warning 알림 (cooldown 적용).
        if (this.currentPage === 1) {
          this.consecutiveIframeMissing += 1;
          logger.warn(
            `No items in page 1 (연속 ${this.consecutiveIframeMissing})`
          );
          if (
            this.consecutiveIframeMissing >= ALERT_IFRAME_MISSING &&
            !this.alertedIframeMissing
          ) {
            this.alertedIframeMissing = true;
            await notifyChat({
              category: "iframe_missing",
              severity: "warning",
              title: `구조 변화 의심: ${this.consecutiveIframeMissing}개 동 연속 0건 (page 1)`,
              context: {
                "검색어": keyword,
                "최근 위치": `${city} ${district} ${dong}`,
                "세션 ID": this.opts.sessionId,
                "권장 조치":
                  "list selector 또는 search iframe URL 패턴 확인 필요",
              },
            }).catch(() => undefined);
          }
        } else {
          logger.warn(`No items in page ${this.currentPage}`);
        }
        break;
      }

      // 1페이지에서 항목 수집 성공 → iframe 카운터만 리셋
      // alertedIframeMissing 은 세션 끝까지 sticky (중간 회복돼도 추가 알림 X)
      if (this.currentPage === 1) {
        this.consecutiveIframeMissing = 0;
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
              collectMenu: this.opts.collectMenu,
            },
            logger
          );

          // detail 단계 카테고리 매칭 — 리스트에선 카테고리 비어 있어 통과한 항목을
          // detail의 category_main 으로 한 번 더 검증한다. category_main 도 비어 있으면 통과.
          if (!matchesCategory(keyword, detail.category_main)) {
            logger.info(
              `🚫 detail 카테고리 미스매치 skip: "${detail.shop_name}" [${detail.category_main}] (keyword="${keyword}")`
            );
            continue;
          }

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
            `❌ ${i}번째 item 저장 실패 (연속 ${this.consecutiveSaveFailures}/${MAX_CONSECUTIVE_SAVE_FAILURES}): ${msg}`
          );

          if (this.consecutiveSaveFailures >= MAX_CONSECUTIVE_SAVE_FAILURES) {
            // 종료 직전 critical 알림 (await 하되 webhook 실패는 swallow)
            await notifyChat({
              category: "save_failures",
              severity: "critical",
              title: `저장 ${MAX_CONSECUTIVE_SAVE_FAILURES}회 연속 실패 — 세션 자동 종료`,
              context: {
                "검색어": keyword,
                "위치": `${city} ${district} ${dong}`,
                "세션 ID": this.opts.sessionId,
                "마지막 에러": msg,
              },
            }).catch(() => undefined);
            throw new Error(
              `CRAWL_ABORT: 저장이 ${MAX_CONSECUTIVE_SAVE_FAILURES}회 연속 실패 — 세션 자동 종료 (마지막: ${msg})`
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

    const savedInThisDong = this.processed - processedAtStart;
    if (savedInThisDong === 0) {
      this.consecutiveEmptyDongs += 1;
      logger.warn(
        `🪹 ${city} ${district} ${dong}에서 저장 0건 (연속 빈 동 ${this.consecutiveEmptyDongs})`
      );
      // 임계치 도달 + 아직 알림 안 보낸 상태에서만 1회 알림.
      // 이후 정상 동(저장 1건+) 발견 시 alerted 플래그 reset → 다음 누적 시 다시 알림 가능.
      if (
        this.consecutiveEmptyDongs >= ALERT_EMPTY_DONGS &&
        !this.alertedEmptyDongs
      ) {
        this.alertedEmptyDongs = true;
        await notifyChat({
          category: "empty_dongs",
          severity: "warning",
          title: `차단 의심: ${this.consecutiveEmptyDongs}개 동 연속 저장 0건`,
          context: {
            "검색어": keyword,
            "최근 위치": `${city} ${district} ${dong}`,
            "세션 ID": this.opts.sessionId,
            "권장 조치":
              "이 세션에서는 더 이상 같은 알림 안 옵니다. 정지 후 SlowMo↑ 또는 IP 변경 권장.",
          },
        }).catch(() => undefined);
      }
    } else {
      // 정상 동 만나면 카운터는 reset (다음 누적 카운트 표시용)
      // 다만 alertedEmptyDongs 는 세션 끝까지 sticky — 중간에 회복돼도 추가 알림 X
      this.consecutiveEmptyDongs = 0;
    }

    // 동 처리 완료 시점에 "90일 동안 못 본 active 가게" → missing 판정
    // (lifecycle 컬럼 없는 v1 테이블이면 placesRepo 가 자체적으로 no-op 처리)
    if (
      !this.stopped &&
      !signal.aborted &&
      placesRepo.markDongMissing &&
      district &&
      dong
    ) {
      try {
        const result = await placesRepo.markDongMissing({
          district,
          dong,
          daysThreshold: 90,
        });
        if (result.count > 0) {
          logger.info(
            `🪦 missing 처리: ${city} ${district} ${dong} ${result.count}건 (90일 이상 미관측)`
          );
        }
      } catch (e) {
        logger.warn(
          `missing 판정 실패: ${e instanceof Error ? e.message : String(e)}`
        );
      }
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
