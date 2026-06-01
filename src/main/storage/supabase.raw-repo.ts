import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "./supabase-client.js";
import type {
  RawCrawlRepo,
  RunMeta,
  RawPlaceRecord,
  RunSummary,
} from "../crawler/extractors/raw-repository.js";

export interface SupabaseRawRepoOptions {
  url: string;
  key: string;
}

/**
 * v3 Data Lake 저장 구현체. 정규화 없이 raw 를 append-only 로 적재한다.
 * 기존 SupabaseRepo(정규화/select/diff/shop_events)는 호출 경로에서 빠지고
 * 이 레포가 그 자리를 대체한다.
 */
export class SupabaseRawRepo implements RawCrawlRepo {
  private client: SupabaseClient;

  constructor(opts: SupabaseRawRepoOptions) {
    if (!opts.url || !opts.key) {
      throw new Error("Supabase URL/Key가 필요합니다.");
    }
    this.client = createClient(opts.url, opts.key);
  }

  async startRun(meta: RunMeta): Promise<string> {
    const row = {
      id: meta.runId,
      source: meta.source ?? "naver_place",
      category: meta.category ?? null,
      keyword: meta.keyword,
      session_id: meta.sessionId,
      host: meta.host ?? null,
      slot_id: meta.slotId ?? null,
      city: meta.city ?? null,
      district: meta.district ?? null,
      dong: meta.dong ?? null,
      status: "running",
      started_at: new Date().toISOString(),
      meta: meta.meta ?? {},
    };
    const { error } = await this.client.from("crawl_runs").insert(row);
    if (error) {
      throw new Error(`crawl_runs insert 실패: ${error.message}`);
    }
    return meta.runId;
  }

  async insertRaw(rec: RawPlaceRecord): Promise<void> {
    const row = {
      run_id: rec.runId,
      place_id: rec.placeId,
      category: rec.category ?? null,
      source: rec.source ?? "naver_place",
      payload: rec.payload,
      raw_html: rec.rawHtml ?? null,
      partial: rec.partial ?? false,
      naver_search: rec.naverSearch ?? rec.payload?.naver_search ?? null,
      scraped_at:
        rec.scrapedAt ?? rec.payload?.scraped_at ?? new Date().toISOString(),
    };
    const { error } = await this.client.from("raw_places").insert(row);
    if (error) {
      throw new Error(`raw_places insert 실패: ${error.message}`);
    }
  }

  async finishRun(runId: string, summary: RunSummary): Promise<void> {
    const patch: Record<string, unknown> = {
      status: summary.status,
      finished_at: new Date().toISOString(),
    };
    if (summary.collectedCount != null)
      patch.collected_count = summary.collectedCount;
    if (summary.savedCount != null) patch.saved_count = summary.savedCount;
    if (summary.error != null) patch.error = summary.error;
    if (summary.dumpLocation != null) patch.dump_location = summary.dumpLocation;

    const { error } = await this.client
      .from("crawl_runs")
      .update(patch)
      .eq("id", runId);
    if (error) {
      throw new Error(`crawl_runs update 실패: ${error.message}`);
    }
  }
}
