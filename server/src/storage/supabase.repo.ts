import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "./supabase-client.js";
import type {
  IPlaceRepo,
  MarkMissingResult,
} from "../crawler/extractors/repository.js";
import type {
  PlaceInfo,
  ScrapedPlaceInfo,
} from "../crawler/extractors/place.js";

export interface SupabaseRepoOptions {
  url: string;
  key: string;
  table: string;
}

const normalize = (value?: string) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const extractPlaceIdFromUrl = (url?: string) => {
  if (!url) return undefined;
  const match = url.match(/\/place\/(\d+)/);
  return match ? match[1] : undefined;
};

/**
 * lifecycle 컬럼(first_seen_at/last_seen_at/status/missing_at) + shop_events 테이블이
 * 존재하는 v2 계열 테이블인지 판정. 사용자 컨벤션상 `_v2` suffix 로 식별.
 */
const isV2Table = (table: string) => /_v2$/i.test(table);

/** updated 이벤트 추적 대상 필드 (변화 의미 있는 비즈니스 필드만) */
const TRACKED_DIFF_FIELDS = [
  "shop_name",
  "phone",
  "address",
  "business_hours",
  "category_main",
  "category_sub",
  "main_menu",
  "tags",
  "instagram",
] as const;
type TrackedField = (typeof TRACKED_DIFF_FIELDS)[number];

interface ShopEventInsert {
  table_name: string;
  place_id: string;
  shop_name?: string | null;
  event_type: "created" | "updated" | "missing" | "reappeared";
  field?: string | null;
  old_value?: string | null;
  new_value?: string | null;
}

export class SupabaseRepo implements IPlaceRepo {
  private client: SupabaseClient;
  private table: string;
  private v2: boolean;

  constructor(opts: SupabaseRepoOptions) {
    if (!opts.url || !opts.key) {
      throw new Error("Supabase URL/Key가 필요합니다.");
    }
    if (!opts.table) {
      throw new Error("Supabase 테이블명이 필요합니다.");
    }
    this.client = createClient(opts.url, opts.key);
    this.table = opts.table;
    this.v2 = isV2Table(opts.table);
  }

  getClient() {
    return this.client;
  }

  getTable() {
    return this.table;
  }

  async upsert(place: PlaceInfo | ScrapedPlaceInfo): Promise<void> {
    const placeId =
      place.place_id ||
      extractPlaceIdFromUrl(place.naver_place_url) ||
      `temp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const naverPlaceUrl =
      normalize(place.naver_place_url) ||
      (placeId && !placeId.startsWith("temp_")
        ? `https://map.naver.com/p/entry/place/${placeId}`
        : undefined);

    const baseData = {
      shop_name: place.shop_name,
      place_id: placeId,
      phone: normalize(place.phone),
      address: normalize(place.address),
      business_hours: normalize(place.business_hours),
      links: normalize(place.links),
      district: normalize(place.district),
      dong: normalize(place.dong),
      city: normalize(place.city),
      category_main: normalize(place.category_main),
      category_sub: normalize(place.category_sub),
      main_menu: normalize(place.main_menu),
      tags: normalize(place.tags),
      naver_place_url: naverPlaceUrl,
      naver_search: normalize(place.naver_search),
      // instagram 은 _v2 계열에만 있는 신규 컬럼이라 값이 있을 때만 키 포함
      ...(normalize(place.instagram)
        ? { instagram: normalize(place.instagram) }
        : {}),
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>;

    // v1 테이블은 기존 단순 upsert (lifecycle 컬럼 없음)
    if (!this.v2) {
      const { error } = await this.client
        .from(this.table)
        .upsert(baseData, { onConflict: "place_id", ignoreDuplicates: false });
      if (error) {
        throw new Error(`Supabase upsert 실패: ${error.message}`);
      }
      return;
    }

    // v2: 기존 row 조회 → 분기 (INSERT vs UPDATE) + 변경 이벤트 기록
    const { data: existing, error: selErr } = await this.client
      .from(this.table)
      .select("*")
      .eq("place_id", placeId)
      .maybeSingle();
    if (selErr) {
      throw new Error(`Supabase select 실패: ${selErr.message}`);
    }

    const nowIso = new Date().toISOString();

    if (!existing) {
      // INSERT 케이스
      const insertData = {
        ...baseData,
        first_seen_at: nowIso,
        last_seen_at: nowIso,
        status: "active",
      };
      const { error: insErr } = await this.client
        .from(this.table)
        .insert(insertData);
      if (insErr) {
        throw new Error(`Supabase insert 실패: ${insErr.message}`);
      }
      await this.recordEvents([
        {
          table_name: this.table,
          place_id: placeId,
          shop_name: (baseData.shop_name as string) ?? null,
          event_type: "created",
        },
      ]);
      return;
    }

    // UPDATE 케이스
    const wasMissing = existing.status === "missing";
    const updateData: Record<string, unknown> = {
      ...baseData,
      last_seen_at: nowIso,
      status: "active",
    };
    if (wasMissing) {
      updateData.missing_at = null;
    }

    const { error: updErr } = await this.client
      .from(this.table)
      .update(updateData)
      .eq("place_id", placeId);
    if (updErr) {
      throw new Error(`Supabase update 실패: ${updErr.message}`);
    }

    // 이벤트 묶어서 한 번에 INSERT (round-trip 절약)
    const events: ShopEventInsert[] = [];

    if (wasMissing) {
      events.push({
        table_name: this.table,
        place_id: placeId,
        shop_name: (baseData.shop_name as string) ?? null,
        event_type: "reappeared",
      });
    }

    for (const field of TRACKED_DIFF_FIELDS) {
      const oldVal = (existing as Record<string, unknown>)[field];
      const newVal = baseData[field];
      const oldStr = oldVal == null ? null : String(oldVal);
      const newStr = newVal == null ? null : String(newVal);
      if (oldStr !== newStr) {
        events.push({
          table_name: this.table,
          place_id: placeId,
          shop_name: (baseData.shop_name as string) ?? null,
          event_type: "updated",
          field,
          old_value: oldStr,
          new_value: newStr,
        });
      }
    }

    if (events.length > 0) {
      await this.recordEvents(events);
    }
  }

  async markDongMissing(args: {
    district: string;
    dong: string;
    daysThreshold: number;
  }): Promise<MarkMissingResult> {
    if (!this.v2) return { count: 0 };

    const cutoffIso = new Date(
      Date.now() - args.daysThreshold * 24 * 60 * 60 * 1000
    ).toISOString();

    // 1) missing 후보 조회 (이벤트 기록 위해 미리 가져옴)
    const { data: candidates, error: selErr } = await this.client
      .from(this.table)
      .select("place_id, shop_name")
      .eq("district", args.district)
      .eq("dong", args.dong)
      .eq("status", "active")
      .lt("last_seen_at", cutoffIso);
    if (selErr) {
      throw new Error(`missing 후보 조회 실패: ${selErr.message}`);
    }
    if (!candidates || candidates.length === 0) {
      return { count: 0 };
    }

    // 2) UPDATE
    const placeIds = candidates.map((c) => c.place_id as string);
    const nowIso = new Date().toISOString();
    const { error: updErr } = await this.client
      .from(this.table)
      .update({ status: "missing", missing_at: nowIso })
      .in("place_id", placeIds);
    if (updErr) {
      throw new Error(`missing UPDATE 실패: ${updErr.message}`);
    }

    // 3) shop_events 일괄 INSERT
    const events: ShopEventInsert[] = candidates.map((c) => ({
      table_name: this.table,
      place_id: c.place_id as string,
      shop_name: (c.shop_name as string) ?? null,
      event_type: "missing",
    }));
    await this.recordEvents(events);

    return { count: candidates.length };
  }

  /** shop_events bulk insert. 실패해도 상위 작업은 계속 진행 (이벤트는 부수적). */
  private async recordEvents(events: ShopEventInsert[]): Promise<void> {
    if (events.length === 0) return;
    const { error } = await this.client.from("shop_events").insert(events);
    if (error) {
      // shop_events 기록 실패는 치명적 아님 — 상위로 throw 안 하고 console 로 남김
      // (logger 의존성을 SupabaseRepo 에 추가하지 않기 위함)
      // eslint-disable-next-line no-console
      console.warn(`shop_events 기록 실패: ${error.message}`);
    }
  }
}
