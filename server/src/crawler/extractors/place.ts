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
  /** 인스타 username만 저장 (예: posh_nail_garosu). 즉 instagram.com/{값}으로 직접 접속 가능. */
  instagram?: string;
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

/**
 * 링크 목록 중 instagram URL 을 찾아 username 만 추출한다.
 * - https://www.instagram.com/posh_nail_garosu/ → posh_nail_garosu
 * - http://instagram.com/foo?utm=... → foo
 * - instagr.am/bar → bar
 *
 * 매칭 안 되면 undefined.
 * `/p/`, `/reel/`, `/explore/`, `/accounts/` 같은 비계정 path 는 건너뛴다.
 */
export function extractInstagramUsername(
  links: ReadonlyArray<string | null | undefined>
): string | undefined {
  const reservedPaths = new Set([
    "p", "reel", "reels", "tv", "explore", "accounts",
    "stories", "direct", "challenges", "tags",
  ]);
  for (const raw of links) {
    if (!raw) continue;
    const url = raw.trim();
    if (!url) continue;
    const m = url.match(
      /^(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am)\/([^/?#\s]+)/i
    );
    if (!m) continue;
    const username = decodeURIComponent(m[1]).replace(/^@/, "").trim();
    if (!username) continue;
    if (reservedPaths.has(username.toLowerCase())) continue;
    return username;
  }
  return undefined;
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
