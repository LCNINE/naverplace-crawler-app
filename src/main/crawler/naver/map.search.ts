import type { Page } from "playwright";
import { Logger } from "../logging/logger.js";
import { humanDelay } from "../utils/human.js";

export async function runSearch(page: Page, keyword: string, log: Logger) {
  log.info("Starting search process...");

  // 1. 네이버 지도 메인 페이지로 이동
  log.info("Navigating to Naver Map...");
  await page.goto("https://map.naver.com", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  // 2. 페이지가 완전히 로딩될 때까지 대기 (랜덤 지터)
  log.info("Waiting for page to fully load...");
  await humanDelay(page, 2500, 4500);

  // 3. 검색창이 나타날 때까지 대기
  // 네이버 지도에 input.input_search 가 2개 렌더되는 케이스가 있어 visible 한 첫 번째만 사용
  log.info("Waiting for search input to appear...");
  const input = page.locator("input.input_search:visible").first();
  await input.waitFor({ state: "visible", timeout: 15000 });

  // 4. 검색 실행 — 클릭/입력/엔터 사이에 사람처럼 짧은 텀을 둔다.
  log.info(`Filling search keyword: ${keyword}`);
  await input.click();
  await humanDelay(page, 300, 800);
  await input.fill(keyword);
  await humanDelay(page, 400, 1000);
  await input.press("Enter");
  log.info({ keyword }, "search.submit");

  // 5. 검색 결과 로딩 대기 (랜덤 지터)
  log.info("Waiting for search results to load...");
  await page.waitForLoadState("domcontentloaded");
  await humanDelay(page, 2500, 4500);

  log.info("Search process completed");
}

export async function openPlaceUrl(page: Page, url: string, log: Logger) {
  log.info(`Navigating to place URL: ${url}`);
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await humanDelay(page, 6000, 9000);
  log.info("Place page loaded");
}
