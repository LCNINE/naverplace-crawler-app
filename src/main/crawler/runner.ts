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
  type ListItem,
} from "./naver/map.list.js";
import { extractDetail } from "./naver/map.detail.js";
import { findSearchFrameByUrl } from "./utils/selectors.js";
import { matchesCategory } from "./utils/category-match.js";
import { humanDelay } from "./utils/human.js";
import { notifyChat } from "../notifier.js";
import type { Logger } from "./logging/logger.js";
import type { RawCrawlRepo, RunStatus } from "./extractors/raw-repository.js";
import { isStructureAssertError, StructureAssertError } from "./asserts.js";
import type { RunRecorder } from "./logging/run-recorder.js";
import { KOREA_CITIES } from "./config/korea-data.js";
import { randomUUID } from "node:crypto";

const IP_BLOCK_ERROR = "IP_BLOCK";
const IP_BLOCK_MAX_RETRIES = 3;
// 점증 백오프 (분 단위). 동영님: 차단/0건이면 몇 시간 텀 두고 2~3회 재시도, 그래도
// 안되면 멈추고 구글챗 보고. env IP_BLOCK_BACKOFF_MIN 으로 조정 (예: "30,120,240").
const IP_BLOCK_BACKOFF_MIN = (process.env.IP_BLOCK_BACKOFF_MIN ?? "30,120,240")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n) && n > 0);
function ipBlockBackoffMs(retry: number): number {
  const arr = IP_BLOCK_BACKOFF_MIN.length > 0 ? IP_BLOCK_BACKOFF_MIN : [30, 120, 240];
  return arr[Math.min(retry - 1, arr.length - 1)] * 60 * 1000;
}

async function detectIpBlock(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    if (/captcha|block|restrict/i.test(url)) return true;

    const bodyText = await page.locator("body").textContent({ timeout: 5000 }).catch(() => "");
    if (!bodyText) return false;

    const t = bodyText.toLowerCase();
    if (t.includes("비정상적인 접근")) return true;
    if (t.includes("비정상적인 검색")) return true;
    if (t.includes("ip") && (t.includes("차단") || t.includes("제한") || t.includes("block"))) return true;
    if (t.includes("이용이 제한")) return true;
    if (t.includes("일시적으로 제한")) return true;
    if (t.includes("자동 등록 방지") || t.includes("자동입력 방지")) return true;
    if (t.includes("보안 인증") && !t.includes("네이버 지도")) return true;
  } catch {
    // ignore
  }
  return false;
}

// 자동 종료 / 알림 임계치
const MAX_CONSECUTIVE_SAVE_FAILURES = 10;  // 도달 시 세션 종료 + critical 알림
const ALERT_EMPTY_DONGS = 10;              // 알림만 (종료 X)
const ALERT_NO_PLACE_ID_RATIO = 0.3;       // 동 내 place_id 누락 비율이 이 이상이면 알림 (추출 열화 의심)
const ALERT_NO_PLACE_ID_MIN_SAMPLE = 5;    // 표본 너무 적으면 알림 안 함(노이즈 방지)
// 구조 깨짐(StructureAssertError)이 연속으로 누적되면 차단/구조변경 확정에 가까움 →
// 이 임계에 도달하면 세션을 멈추고 critical 알림을 보낸다(동영님: 멈추고 보고).
const ABORT_STRUCTURE_BROKEN = 5;

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
  /** 사용자 정의 추가 카테고리 단어. matchesCategory에 그대로 전달. */
  extraCategoryKeywords?: string[];
  resumeFrom?: ResumeFrom;
  /** 전국 순회 완주 후 처음부터 자동 재시작 (all_korea 모드 전용) */
  autoRestart?: boolean;
  /** Playwright persistent context 프로파일 경로 (서버에서 워커별 분리용) */
  userDataDir?: string;
  /** v3 Data Lake 저장 레이어. 정규화 없이 raw 를 append-only 적재. */
  rawRepo: RawCrawlRepo;
  /** canonical category 키 (예: 'coin_laundry'). 없으면 keyword 사용. */
  category?: string;
  /** os.hostname() — crawl_runs/실패 dump 메타에 기록 (어느 노트북인지) */
  host?: string;
  /** QueueManager 슬롯 번호 */
  slotId?: number;
  /**
   * 메모리버퍼 Logger. 주입하면 동(run) 단위로 reset/finalize 하며,
   * run 실패 시 로그+스크린샷을 dump 한다. logger 는 보통 recorder.asLogger() 를 넘긴다.
   */
  recorder?: RunRecorder;
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
  /** 현재 처리 중인 동(run)의 id */
  private currentRunId = "";

  // 알림/자동종료 카운터
  private consecutiveSaveFailures = 0;
  private consecutiveEmptyDongs = 0;
  private consecutiveStructureBroken = 0;

  // "이미 알림 발송함" 플래그 — 한번 true 되면 세션 종료까지 sticky.
  // 자연 분포(시골/변두리 동) 에서도 임계 누적이 잦아 false positive 가 빈번하므로
  // 카테고리당 세션 1회만 알림. 사용자가 정지 후 다시 시작하면 새 세션이라 다시 알림 가능.
  private alertedEmptyDongs = false;

  constructor(private opts: CrawlSessionOptions) {
    this.browser = new PlaywrightController({
      headful: opts.headful,
      slowMo: opts.slowMo,
      log: opts.logger,
      ...(opts.userDataDir ? { userDataDir: opts.userDataDir } : {}),
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
    const { logger, keyword } = this.opts;
    const cities = Object.keys(KOREA_CITIES);
    let startCi = this.opts.resumeFrom?.cityIndex ?? 0;
    let startDi = this.opts.resumeFrom?.districtIndex ?? 0;
    let startDoi = this.opts.resumeFrom?.dongIndex ?? 0;
    let roundCount = 0;

    while (!this.stopped) {
      roundCount += 1;
      if (roundCount > 1) {
        logger.info(`🔁 전국 자동 재시작 (${roundCount}회차)`);
        await notifyChat({
          category: "session_restarted",
          severity: "info",
          title: `🔁 전국 순회 자동 재시작 (${roundCount}회차)`,
          context: {
            "검색어": this.opts.keyword,
            "세션 ID": this.opts.sessionId,
          },
        }).catch(() => undefined);
        // 재시작 시에는 카운터/알림 플래그 리셋
        this.consecutiveEmptyDongs = 0;
        this.consecutiveStructureBroken = 0;
        this.consecutiveSaveFailures = 0;
        this.alertedEmptyDongs = false;
      }

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
              roundCount === 1 &&
              ci === startCi &&
              di === startDi &&
              doi === startDoi;

            let ipBlockRetry = 0;
            while (!this.stopped) {
              try {
                await this.processOne({
                  city,
                  district,
                  dong,
                  resumePage: isResumeOrigin && ipBlockRetry === 0
                    ? this.opts.resumeFrom?.page
                    : undefined,
                  resumeListIndex: isResumeOrigin && ipBlockRetry === 0
                    ? this.opts.resumeFrom?.listIndex
                    : undefined,
                });
                // 정상 처리(빈 동 확인 포함) → 구조 깨짐 카운터 리셋
                this.consecutiveStructureBroken = 0;
                break;
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);

                if (msg.startsWith("CRAWL_ABORT:")) {
                  logger.fatal(`🛑 ${msg}`);
                  throw err;
                }

                if (msg.startsWith(`${IP_BLOCK_ERROR}:`)) {
                  ipBlockRetry++;
                  const waitMs = ipBlockBackoffMs(ipBlockRetry);
                  if (ipBlockRetry > IP_BLOCK_MAX_RETRIES) {
                    // 동영님 방향: 다음 동으로 슬쩍 넘어가지 않고 멈추고 보고한다.
                    await notifyChat({
                      category: "blocked_backoff",
                      severity: "critical",
                      title: `IP 차단 ${IP_BLOCK_MAX_RETRIES}회 백오프 실패 — 세션 자동 종료`,
                      context: {
                        "검색어": keyword,
                        "최근 위치": `${city} ${district} ${dong}`,
                        "세션 ID": this.opts.sessionId,
                        "권장 조치":
                          "IP 변경 / 동시 슬롯 축소(MAX_SLOTS↓) / 잠시 후 재개 권장.",
                      },
                    }).catch(() => undefined);
                    throw new Error(
                      `CRAWL_ABORT: IP 차단 백오프 ${IP_BLOCK_MAX_RETRIES}회 초과 — 세션 종료 (${city} ${district} ${dong})`
                    );
                  }
                  logger.warn(
                    `🚫 IP 차단 감지 — ${Math.round(waitMs / 60000)}분 대기 후 재시도 (${ipBlockRetry}/${IP_BLOCK_MAX_RETRIES})`
                  );
                  await notifyChat({
                    category: "blocked_backoff",
                    severity: "warning",
                    title: `IP 차단 백오프 진입 (${ipBlockRetry}/${IP_BLOCK_MAX_RETRIES}) — ${Math.round(waitMs / 60000)}분 대기`,
                    context: {
                      "검색어": keyword,
                      "최근 위치": `${city} ${district} ${dong}`,
                      "세션 ID": this.opts.sessionId,
                    },
                  }).catch(() => undefined);
                  await this.recycleBrowser("IP block - waiting").catch(() => {});
                  await new Promise((r) => setTimeout(r, waitMs));
                  continue;
                }

                if (isStructureAssertError(err)) {
                  this.consecutiveStructureBroken += 1;
                  logger.error(
                    { error: msg },
                    `🧱 구조 깨짐 의심 (연속 ${this.consecutiveStructureBroken}/${ABORT_STRUCTURE_BROKEN}): ${city} ${district} ${dong}`
                  );
                  if (this.consecutiveStructureBroken >= ABORT_STRUCTURE_BROKEN) {
                    await notifyChat({
                      category: "structure_broken",
                      severity: "critical",
                      title: `구조 깨짐 ${this.consecutiveStructureBroken}회 연속 — 세션 자동 종료`,
                      context: {
                        "검색어": keyword,
                        "최근 위치": `${city} ${district} ${dong}`,
                        "세션 ID": this.opts.sessionId,
                        "권장 조치":
                          "list/detail 셀렉터 또는 search iframe 구조 변경, 혹은 IP 차단 확인. run dump 로그 참고.",
                      },
                    }).catch(() => undefined);
                    throw new Error(
                      `CRAWL_ABORT: 구조 깨짐 ${this.consecutiveStructureBroken}회 연속 — 세션 종료 (${city} ${district} ${dong})`
                    );
                  }
                  break; // 다음 동으로
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
                break;
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

      if (this.stopped) break;

      logger.info(`🎉 전국 자동 순회 완료 (${roundCount}회차)`);

      if (!this.opts.autoRestart) break;

      // 다음 회차는 처음부터
      startCi = 0;
      startDi = 0;
      startDoi = 0;
    }

    if (!this.stopped) {
      logger.info("✅ 전국 순회 모든 회차 완료");
    }
  }

  /**
   * 1페이지 리스트 수집이 실패(StructureAssertError)했을 때, 그게 "진짜 빈 동"인지
   * "차단/일시 실패/구조 변경"인지 가린다.
   *  1) 차단 시그널이 보이면 즉시 IP_BLOCK 으로 승격 → 백오프/재시도/알림 흐름을 탄다.
   *  2) 시그널이 없으면 soft block 또는 일시 로딩 실패일 수 있으니 재검색을 2회까지 시도.
   *     - 항목이 나오면 반환(빈 동/구조 오판 회피)
   *     - collectListItems 가 [] 를 반환하면 '검색 결과 없음' 마커가 확인된 진짜 빈 동
   *     - 끝까지 StructureAssertError 면 진짜 구조 깨짐으로 보고 throw (run = assert_failed)
   * 이전 버전은 0건을 무조건 "빈 동"으로 처리해 soft block 으로 누락된 데이터를
   * 정상으로 오인했다 — 빨래방 1400건 누락의 핵심 원인.
   */
  private async recoverList(
    city: string,
    district: string,
    dong: string,
    keyword: string,
    originalErr: unknown
  ): Promise<ListItem[]> {
    const { logger, recorder } = this.opts;
    if (!this.page) return [];
    if (recorder) await recorder.screenshot(this.page, "list_failure");

    if (await detectIpBlock(this.page)) {
      logger.warn("🚫 리스트 수집 실패 + IP 차단 시그널 → 차단 처리");
      throw new Error(`${IP_BLOCK_ERROR}: ${district} ${dong}`);
    }

    const RETRY = 2;
    for (let r = 1; r <= RETRY; r++) {
      logger.warn(
        `🔍 ${city} ${district} ${dong} 리스트 수집 실패 — 재검색 ${r}/${RETRY}`
      );
      await humanDelay(this.page, 4000, 8000);
      await runSearch(this.page, `${district} ${dong} ${keyword}`, logger);

      if (await detectIpBlock(this.page)) {
        logger.warn("🚫 재검색 중 IP 차단 시그널 → 차단 처리");
        throw new Error(`${IP_BLOCK_ERROR}: ${district} ${dong}`);
      }

      try {
        const retried = await collectListItems(this.page, logger);
        if (retried.length > 0) {
          logger.info(
            `✅ 재검색 ${r}회차에서 ${retried.length}건 수집 — 빈 동/구조 오판 회피`
          );
          return retried;
        }
        // [] = '검색 결과 없음' 마커가 확인된 진짜 빈 동
        logger.info("🪹 재검색에서 '결과 없음' 마커 확인 — 실제 빈 동");
        return [];
      } catch (e) {
        if (isStructureAssertError(e)) {
          continue; // 여전히 구조 문제 → 다음 재검색
        }
        throw e;
      }
    }

    // 재검색을 다 했는데도 구조 문제 → 진짜 구조 깨짐으로 보고 throw
    if (recorder) await recorder.screenshot(this.page, "list_unrecoverable");
    throw originalErr instanceof Error
      ? originalErr
      : new StructureAssertError("list_unrecoverable");
  }

  private async processOne(args: ProcessOneArgs): Promise<void> {
    const { logger, rawRepo, recorder, signal, keyword } = this.opts;
    const { city, district, dong, resumePage, resumeListIndex } = args;
    if (!this.page) throw new Error("page not initialized");

    this.currentPage = 1;
    this.currentListIndex = 0;
    const processedAtStart = this.processed;
    const category = this.opts.category ?? keyword;

    // run 경계: 동 1개 = 1 run. crawl_runs 에 기록하고 RunRecorder 를 초기화한다.
    const runId = randomUUID();
    this.currentRunId = runId;
    recorder?.reset(runId);
    recorder?.marker(`dong_start ${city} ${district} ${dong}`);
    let collected = 0; // 추출 시도 성공 건수
    let saved = 0; // raw insert 성공 건수
    let noPlaceId = 0; // saved 중 place_id 없음(=canonical 제외 예정) 건수
    let runStarted = false;
    try {
      await rawRepo.startRun({
        runId,
        sessionId: this.opts.sessionId,
        keyword,
        category,
        host: this.opts.host,
        slotId: this.opts.slotId,
        city,
        district,
        dong,
        source: "naver_place",
      });
      runStarted = true;
    } catch (e) {
      logger.error(
        `crawl_runs startRun 실패: ${e instanceof Error ? e.message : String(e)}`
      );
    }

    try {
      logger.info(`🎯 ${city} ${district} ${dong} (keyword: ${keyword}) 처리 시작`);

      await runSearch(this.page, `${district} ${dong} ${keyword}`, logger);
      // 검색 직후 한 장 — 성공 run 은 finalizeSuccess 에서 버려지고, 실패 시 dump 에 포함.
      if (recorder) await recorder.screenshot(this.page, "after_search");

      if (await detectIpBlock(this.page)) {
        logger.warn("🚫 IP 차단 페이지 감지");
        throw new Error(`${IP_BLOCK_ERROR}: ${district} ${dong}`);
      }

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

        let items: ListItem[];
        try {
          items = await collectListItems(this.page, logger);
        } catch (err) {
          // 1페이지 첫 시도의 구조 실패만 복구(재검색) 시도, 그 외엔 그대로 throw → run 실패
          if (
            isStructureAssertError(err) &&
            this.currentPage === 1 &&
            firstIteration
          ) {
            items = await this.recoverList(city, district, dong, keyword, err);
          } else {
            throw err;
          }
        }

        if (items.length === 0) {
          // collectListItems/recoverList 가 [] 를 반환 = '검색 결과 없음' 마커가
          // 확인된 진짜 빈 동(구조/차단 의심이면 throw 되어 여기 안 옴).
          logger.info(
            `🪹 빈 동 확인: ${city} ${district} ${dong} (page ${this.currentPage})`
          );
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
          if (
            !matchesCategory(
              keyword,
              item.category,
              this.opts.extraCategoryKeywords
            )
          ) {
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

          // 가게 간 사람처럼 보이는 짧은 텀 — 클릭 직후 detail 추출 전에 둔다.
          await humanDelay(this.page, 700, 1800);

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
            collected += 1;

            // detail 단계 카테고리 매칭 — 리스트에선 카테고리 비어 있어 통과한 항목을
            // detail의 category_main 으로 한 번 더 검증한다. category_main 도 비어 있으면 통과.
            if (
              !matchesCategory(
                keyword,
                detail.category_main,
                this.opts.extraCategoryKeywords
              )
            ) {
              logger.info(
                `🚫 detail 카테고리 미스매치 skip: "${detail.shop_name}" [${detail.category_main}] (keyword="${keyword}")`
              );
              continue;
            }

            // v3: 정규화하지 않고 raw 를 append-only 로 적재. place_id 가 없으면
            // canonical dedup 키가 없으므로 partial 로 표시(canonical 변환에서 제외).
            await rawRepo.insertRaw({
              runId,
              placeId: detail.place_id ?? null,
              category,
              source: "naver_place",
              payload: {
                ...detail,
                naver_search: `${district} ${dong} ${keyword}`,
              },
              partial: !detail.place_id,
              scrapedAt: detail.scraped_at,
            });
            saved += 1;
            if (!detail.place_id) noPlaceId += 1;
            this.processed += 1;
            this.consecutiveSaveFailures = 0;
            this.emitProgress();
            logger.info(
              `💾 raw 저장 (#${this.processed}): ${detail.shop_name} · ${
                detail.address ?? "주소 없음"
              }${detail.place_id ? "" : " ⚠️place_id 없음(partial)"}`
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
        await humanDelay(this.page, 1500, 3500);
      }

      const savedInThisDong = this.processed - processedAtStart;
      if (savedInThisDong === 0) {
        this.consecutiveEmptyDongs += 1;
        logger.warn(
          `🪹 ${city} ${district} ${dong}에서 저장 0건 (연속 빈 동 ${this.consecutiveEmptyDongs})`
        );
        // 임계치 도달 + 아직 알림 안 보낸 상태에서만 1회 알림.
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
        // 정상 동 만나면 카운터는 reset (다만 alertedEmptyDongs 는 세션 끝까지 sticky)
        this.consecutiveEmptyDongs = 0;
      }

      // missing 판정은 v3 에선 크롤러가 하지 않는다 — canonical sync 함수가
      // completed run 커버리지를 근거로 일괄 처리한다(빨래방 누락 재발 방지의 일부).

      logger.info(
        this.stopped
          ? `🛑 중지됨 (${city} ${district} ${dong} page=${this.currentPage}, idx=${this.currentListIndex})`
          : `✅ ${city} ${district} ${dong} 완료 (이 동에서 ${savedInThisDong}건, 누적 ${this.processed}건)`
      );

      // run 정상 종료
      if (runStarted) {
        await rawRepo
          .finishRun(runId, {
            status: this.stopped ? "aborted" : "completed",
            collectedCount: collected,
            savedCount: saved,
          })
          .catch((e) =>
            logger.warn(
              `finishRun(completed) 실패: ${e instanceof Error ? e.message : String(e)}`
            )
          );

        // place_id 누락 비율이 높으면 추출이 조용히 망가지는 신호 → 알림 (빨래방 누락 재발 방지).
        // place_id 는 네이버 플레이스 URL 에 항상 있으므로, 누락 다발 = 셀렉터 깨짐/차단 의심.
        if (
          !this.stopped &&
          saved >= ALERT_NO_PLACE_ID_MIN_SAMPLE &&
          noPlaceId / saved >= ALERT_NO_PLACE_ID_RATIO
        ) {
          await notifyChat({
            category: "high_exclusion",
            severity: "warning",
            title: `place_id 누락 ${Math.round((noPlaceId / saved) * 100)}% — 추출 열화 의심`,
            context: {
              "검색어": keyword,
              "위치": `${city} ${district} ${dong}`,
              "세션 ID": this.opts.sessionId,
              "저장/누락": `${saved}건 중 ${noPlaceId}건 place_id 없음 (canonical 제외 예정)`,
              "권장 조치": "detail 추출 셀렉터/차단 여부 확인.",
            },
          }).catch(() => undefined);
        }
      }
      recorder?.finalizeSuccess({ city, district, dong, collected, saved });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status: RunStatus = msg.startsWith(`${IP_BLOCK_ERROR}:`)
        ? "blocked"
        : msg.startsWith("CRAWL_ABORT:")
        ? "aborted"
        : isStructureAssertError(err)
        ? "assert_failed"
        : "error";
      const dump = recorder ? await recorder.finalizeFailure(`${status}: ${msg}`) : null;
      if (runStarted) {
        await rawRepo
          .finishRun(runId, {
            status,
            collectedCount: collected,
            savedCount: saved,
            error: msg,
            dumpLocation: dump?.location,
          })
          .catch(() => undefined);
      }
      throw err;
    }
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
