import type { Page } from "playwright";
import { Logger } from "../logging/logger.js";

export async function runSearch(page: Page, keyword: string, log: Logger) {
  log.info("Starting search process...");

  // 1. 네이버 지도 메인 페이지로 이동
  log.info("Navigating to Naver Map...");
  await page.goto("https://map.naver.com", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  // 2. 페이지가 완전히 로딩될 때까지 대기
  log.info("Waiting for page to fully load...");
  await page.waitForTimeout(3000);

  // 3. 검색창이 나타날 때까지 대기
  // 네이버 지도에 input.input_search 가 2개 렌더되는 케이스가 있어 visible 한 첫 번째만 사용
  log.info("Waiting for search input to appear...");
  const input = page.locator("input.input_search:visible").first();
  await input.waitFor({ state: "visible", timeout: 15000 });

  // 4. 검색 실행
  log.info(`Filling search keyword: ${keyword}`);
  await input.fill(keyword);
  await input.press("Enter");
  log.info({ keyword }, "search.submit");

  // 5. 검색 결과 로딩 대기
  log.info("Waiting for search results to load...");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3000);

  log.info("Search process completed");
}

export async function openPlaceUrl(page: Page, url: string, log: Logger) {
  log.info(`Navigating to place URL: ${url}`);
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(8000);
  log.info("Place page loaded");
}
