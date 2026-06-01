import type { ScrapedPlaceInfo } from "./place.js";

/**
 * v3 Data Lake 저장 레이어.
 *
 * 크롤러는 더 이상 정규화/upsert 하지 않는다. 추출 직후의 원본(payload)을
 * run_id/place_id/category/source 와 함께 append-only 로 적재만 하고,
 * 정규화(canonical 변환)는 DB 의 sync_canonical_places() 가 별도로 수행한다.
 *
 * run = 동(dong) 단위. crawl_runs row 하나 = "한 동에서의 한 번 크롤링".
 */

export type RunStatus =
  | "running"
  | "completed"
  | "blocked"
  | "assert_failed"
  | "error"
  | "aborted";

export interface RunMeta {
  /** 클라이언트(크롤러)에서 randomUUID() 로 생성한 run id. crawl_runs.id 로 그대로 사용. */
  runId: string;
  /** task.id — run 들을 task 단위로 묶는 키 */
  sessionId: string;
  /** 기본 'naver_place' */
  source?: string;
  /** 업종 키 ('hair'|'nail'|'lash'|'waxing'|'coin_laundry'|'skin'|'tattoo'|...) */
  category?: string;
  keyword: string;
  /** os.hostname() — 어느 노트북에서 돌았는지 */
  host?: string;
  slotId?: number;
  city?: string;
  district?: string;
  dong?: string;
  meta?: Record<string, unknown>;
}

export interface RawPlaceRecord {
  runId: string;
  /** 추출 실패 시 null — canonical 변환에서 제외됨 */
  placeId: string | null;
  category?: string;
  source?: string;
  /** 추출 원본을 통째로 보존 (정규화 X) */
  payload: ScrapedPlaceInfo & { naver_search?: string };
  /** 옵션: detail 페이지 html 일부 */
  rawHtml?: string;
  /** assert 실패/필수필드 누락 시 true — canonical 변환에서 제외됨 */
  partial?: boolean;
  naverSearch?: string;
  scrapedAt?: string;
}

export interface RunSummary {
  status: RunStatus;
  collectedCount?: number;
  savedCount?: number;
  error?: string;
  dumpLocation?: string;
}

export interface RawCrawlRepo {
  /** crawl_runs insert(status=running) → run_id 반환 */
  startRun(meta: RunMeta): Promise<string>;
  /** raw_places append-only insert (upsert 아님) */
  insertRaw(rec: RawPlaceRecord): Promise<void>;
  /** crawl_runs status/카운트/dump_location 갱신 */
  finishRun(runId: string, summary: RunSummary): Promise<void>;
}
