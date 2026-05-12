import type { FrameLocator, Page, Frame } from "playwright";

export function searchFrame(page: Page) {
  // 검색 결과가 들어오는 우측 프레임(지도 v3 기준)
  return page.frameLocator('iframe#searchIframe, iframe[id*="searchIframe"]');
}

export function entryFrame(page: Page) {
  // 상세 보기가 들어오는 프레임
  return page.frameLocator('iframe#entryIframe, iframe[id*="entryIframe"]');
}

// 네이버는 검색 카테고리별로 path 가 다름 (/place/list, /lashshop/list, /restaurant/list,
// /hairshop/list, /nailshop/list, /accommodation/list 등). 도메인 + `/list` 만으로
// broad 매칭하고, 추가로 #searchIframe id 도 후보로 인정한다.
function isLikelySearchFrame(url: string, title: string): boolean {
  const isPlaceDomain =
    url.includes("pcmap.place.naver.com") || url.includes("place.naver.com");
  if (isPlaceDomain && url.includes("/list")) return true;
  if (title.includes("Naver Place Search") && isPlaceDomain) return true;
  return false;
}

export async function findSearchFrameByUrl(
  page: Page,
  log?: { warn: (a: unknown, b?: string) => void; debug?: (a: unknown, b?: string) => void }
): Promise<Frame | null> {
  const frames = page.frames();
  const seen: { url: string; name: string }[] = [];

  for (const frame of frames) {
    try {
      const url = frame.url();
      const title = await frame.title().catch(() => "");
      seen.push({ url, name: frame.name() });

      if (isLikelySearchFrame(url, title)) {
        const hasContent = await frame
          .evaluate(() => document.querySelectorAll("*").length > 100)
          .catch(() => false);
        if (hasContent) return frame;
      }
    } catch {
      continue;
    }
  }

  // 매칭 실패 시 가시성을 위해 모든 frame URL 을 로그에 남긴다 — 셀렉터 갱신 진단용.
  if (log?.warn) {
    log.warn(
      { frames: seen },
      "❌ search iframe 매칭 실패 — 현재 페이지의 모든 frame URL 확인"
    );
  }

  return null;
}
