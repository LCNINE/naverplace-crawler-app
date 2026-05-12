import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "./supabase-client.js";
import type { IPlaceRepo } from "../crawler/extractors/repository.js";
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

export class SupabaseRepo implements IPlaceRepo {
  private client: SupabaseClient;
  private table: string;

  constructor(opts: SupabaseRepoOptions) {
    if (!opts.url || !opts.key) {
      throw new Error("Supabase URL/Key가 필요합니다.");
    }
    if (!opts.table) {
      throw new Error("Supabase 테이블명이 필요합니다.");
    }
    this.client = createClient(opts.url, opts.key);
    this.table = opts.table;
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

    const supabaseData = {
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
      updated_at: new Date().toISOString(),
    };

    const { error } = await this.client.from(this.table).upsert(supabaseData, {
      onConflict: "place_id",
      ignoreDuplicates: false,
    });

    if (error) {
      throw new Error(`Supabase upsert 실패: ${error.message}`);
    }
  }
}
