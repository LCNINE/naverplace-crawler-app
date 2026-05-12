export interface PlaceInfo {
  id?: number;
  shop_name: string;
  place_id?: string;
  phone?: string;
  address?: string;
  business_hours?: string;
  links?: string;
  city?: string;
  district?: string;
  dong?: string;
  image?: string;
  category_main?: string;
  category_sub?: string;
  main_menu?: string;
  tags?: string;
  naver_place_url?: string;
  naver_search?: string;
  created_at?: string;
  updated_at?: string;
}

// 스크래핑 시 사용할 확장 인터페이스
export interface ScrapedPlaceInfo extends PlaceInfo {
  page: number;
  scraped_at: string;
}

export function normalizeText(s?: string | null) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

export function extractDongFromAddress(address?: string | null) {
  const text = normalizeText(address);
  if (!text) return undefined;
  const tokens = text.split(" ");
  const dongToken = tokens.find((token) => {
    const cleaned = token.replace(/[(),]/g, "");
    if (/[0-9]/.test(cleaned)) return false;
    if (/(층|호)$/.test(cleaned)) return false;
    if (/호동$/.test(cleaned)) return false;
    return /(동|읍|면)$/.test(cleaned);
  });
  return dongToken ? dongToken.replace(/[(),]/g, "") : undefined;
}
