import type { FrameLocator, Page, Frame } from "playwright";

export function searchFrame(page: Page) {
  // 검색 결과가 들어오는 우측 프레임(지도 v3 기준)
  return page.frameLocator('iframe#searchIframe, iframe[id*="searchIframe"]');
}

export function entryFrame(page: Page) {
  // 상세 보기가 들어오는 프레임
  return page.frameLocator('iframe#entryIframe, iframe[id*="entryIframe"]');
}

// lash_scraper_seoul.js의 성공적인 패턴을 기반으로 한 iframe 찾기
export async function findSearchFrameByUrl(page: Page): Promise<Frame | null> {
  const frames = page.frames();

  for (const frame of frames) {
    try {
      const url = frame.url();
      const title = await frame.title().catch(() => "");

      // 검색 결과 iframe을 찾기 위한 패턴 (솥밥은 restaurant/list 사용)
      if (
        url.includes("pcmap.place.naver.com/place/list") ||
        url.includes("pcmap.place.naver.com/lashshop/list") ||
        url.includes("pcmap.place.naver.com/restaurant/list") ||
        url.includes("/place/list") ||
        (title.includes("Naver Place Search") &&
          url.includes("pcmap.place.naver.com"))
      ) {
        // iframe 내용이 실제로 로드되었는지 확인
        const hasContent = await frame
          .evaluate(() => {
            return document.querySelectorAll("*").length > 100;
          })
          .catch(() => false);

        if (hasContent) {
          return frame;
        }
      }
    } catch (error) {
      continue;
    }
  }

  return null;
}
