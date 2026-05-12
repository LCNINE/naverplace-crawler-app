import type { Page, Frame } from "playwright";
import { Logger } from "../logging/logger.js";
import { searchFrame, findSearchFrameByUrl } from "../utils/selectors.js";

export interface ListItem {
  index: number;
  name: string;
  category?: string;
}

export async function collectListItems(
  page: Page,
  log: Logger
): Promise<ListItem[]> {
  log.info("Starting shop list collection...");

  // lash_scraper_seoul.js의 성공적인 패턴으로 iframe 찾기
  let searchFrameElement = await findSearchFrameByUrl(page);
  if (!searchFrameElement) {
    log.warn("Search result iframe not found");
    return [];
  }

  log.info("Search result iframe found");

  // lash_scraper_seoul.js의 성공적인 패턴: 스크롤하면서 모든 플레이스 수집
  const result: ListItem[] = [];
  // 네이버 지도가 lazyload + re-render를 하므로 element 참조 기반 dedup은 동작하지 않는다.
  // 이름 string 기반으로 dedup 하면 같은 이름의 다른 가게가 함께 떠도 1번만 카운트되지만,
  // 그 정도 손실보다 5배씩 부풀어 295번까지 가는 문제가 더 크기 때문에 string 기반을 선택.
  const seenNames = new Set<string>();

  try {
    // 1. 스크롤 컨테이너 찾기 (lash_scraper_seoul.js에서 성공적으로 사용되는 패턴)
    const scrollContainer = await searchFrameElement.$(
      'div[id="_pcmap_list_scroll_container"]'
    );

    if (scrollContainer) {
      log.info("Scroll container found: _pcmap_list_scroll_container");

      // 2. 스크롤하면서 모든 span.YwYLL 수집 (lash_scraper_seoul.js 패턴)
      let previousCount = 0;
      let noNewShopsCount = 0;
      const maxScrollAttempts = 5;
      let lastScrollHeight = 0;

      for (
        let scrollAttempt = 0;
        scrollAttempt < maxScrollAttempts;
        scrollAttempt++
      ) {
        log.info(`Scroll attempt ${scrollAttempt + 1}/${maxScrollAttempts}...`);

        try {
          // iframe 상태 확인 및 복구
          try {
            await searchFrameElement.evaluate(() => document.body);
          } catch (frameError) {
            const errorMessage =
              frameError instanceof Error
                ? frameError.message
                : String(frameError);
            if (errorMessage.includes("Frame was detached")) {
              log.warn("⚠️ iframe이 분리됨, 복구 시도 중...");

              // 새로운 iframe 찾기 시도
              const newSearchFrame = await findSearchFrameByUrl(page);
              if (newSearchFrame) {
                searchFrameElement = newSearchFrame;
                log.info("✅ iframe 복구 성공, 계속 진행");

                // 새로운 iframe에서 스크롤 컨테이너 다시 찾기
                const newScrollContainer = await searchFrameElement.$(
                  'div[id="_pcmap_list_scroll_container"]'
                );
                if (newScrollContainer) {
                  log.info("✅ 새로운 iframe에서 스크롤 컨테이너 발견");
                  // scrollContainer 변수 업데이트
                  Object.assign(scrollContainer, newScrollContainer);
                } else {
                  log.warn(
                    "❌ 새로운 iframe에서 스크롤 컨테이너를 찾을 수 없음"
                  );
                  break;
                }
              } else {
                log.warn("❌ iframe 복구 실패, 이미 수집된 항목들 반환");
                break;
              }
            } else {
              throw frameError;
            }
          }

          // 현재 스크롤 높이 확인
          const currentScrollHeight = await searchFrameElement.evaluate(
            (container) => {
              return container ? container.scrollHeight : 0;
            },
            scrollContainer
          );

          log.debug(`Current scroll height: ${currentScrollHeight}`);

          // 현재 화면에 보이는 가게 이름 요소들 찾기
          if (searchFrameElement) {
            // 여러 셀렉터 시도 (네이버 지도 구조 변경 대응)
            const selectors = [
              "a.place_bluelink span",  // 현재 동작하는 셀렉터
              "span.YwYLL",             // 이전 버전
              "span[class*='name']",
              "div[class*='name']"
            ];
            
            let currentNameSpans: any[] = [];
            for (const selector of selectors) {
              currentNameSpans = await searchFrameElement.$$(selector);
              if (currentNameSpans.length > 0) {
                log.debug(`Using selector: ${selector} (${currentNameSpans.length} elements)`);
                break;
              }
            }
            
            if (currentNameSpans.length === 0) {
              log.warn("No name elements found with any selector");
              break;
            }

            // 새로운 이름만 추가 (이름 string 기반 dedup)
            for (const nameSpan of currentNameSpans) {
              try {
                const shopName = await nameSpan.textContent();
                if (!shopName) continue;
                const trimmedName = shopName.trim();
                if (trimmedName.length === 0) continue;

                // 광고 관련 텍스트 필터링
                if (
                  trimmedName === "광고" ||
                  trimmedName.startsWith("광고") ||
                  trimmedName.endsWith("광고") ||
                  (trimmedName.includes("광고") && trimmedName.length <= 10)
                ) {
                  log.debug(`Excluded ad-related text: "${trimmedName}"`);
                  continue;
                }

                if (seenNames.has(trimmedName)) continue;
                seenNames.add(trimmedName);
                result.push({ index: result.length, name: trimmedName });
                log.debug(`New place found: "${trimmedName}"`);
              } catch (e) {
                continue;
              }
            }
          }

          // 새로운 요소가 추가되었는지 확인
          if (result.length === previousCount) {
            noNewShopsCount++;
            log.debug(`No new places found (${noNewShopsCount}/5)`);

            // 스크롤 높이 변화도 확인
            if (currentScrollHeight === lastScrollHeight) {
              log.debug("Scroll height unchanged");
            }

            if (noNewShopsCount >= 5) {
              log.info(
                "5 consecutive attempts with no new places, collection complete"
              );
              break;
            }
          } else {
            noNewShopsCount = 0; // 리셋
            log.info(`New places added: ${result.length - previousCount}`);
          }

          previousCount = result.length;
          lastScrollHeight = currentScrollHeight;

          // 스크롤 수행
          try {
            const scrollResult = await searchFrameElement.evaluate(
              (container) => {
                if (
                  container &&
                  container.scrollHeight > container.clientHeight
                ) {
                  // 더 부드러운 스크롤 (전체 높이의 80%만 스크롤)
                  const scrollAmount = Math.floor(container.scrollHeight * 0.8);
                  container.scrollTop = scrollAmount;
                  return true;
                }
                return false;
              },
              scrollContainer
            );

            if (scrollResult) {
              log.info("Scroll performed");

              // 스크롤 후 로딩 대기
              await searchFrameElement.waitForTimeout(2000);

              // lazyload-wrapper가 사라질 때까지 대기
              try {
                const frameRef = searchFrameElement;
                await frameRef.waitForFunction(
                  async () => {
                    const wrapperCount = await frameRef
                      .locator('div[class*="lazyload-wrapper"]')
                      .count();
                    return wrapperCount === 0;
                  },
                  { timeout: 4000 }
                );
                log.info("Lazyload-wrapper disappeared, continuing...");
              } catch (e) {
                log.warn("Lazyload-wrapper wait timeout, continuing...");
              }
            } else {
              log.info("No more scrolling possible");
              break;
            }
          } catch (e) {
            log.warn(
              `Scroll failed: ${e instanceof Error ? e.message : String(e)}`
            );
            break;
          }
        } catch (scrollError) {
          const errorMessage =
            scrollError instanceof Error
              ? scrollError.message
              : String(scrollError);
          log.warn(
            `Scroll attempt ${scrollAttempt + 1} failed: ${errorMessage}`
          );

          // iframe 분리 오류가 아닌 경우에만 계속 시도
          if (!errorMessage.includes("Frame was detached")) {
            continue;
          } else {
            log.warn("iframe 분리로 인한 스크롤 실패, 이미 수집된 항목들 반환");
            break;
          }
        }
      }

      log.info(`Scroll complete, total ${result.length} places collected`);

      // li 단위로 한 번 더 훑어서 매장명 → 카테고리 매핑을 채운다.
      // 리스트 카드의 span.YzBgS 가 카테고리(예: "왁싱,제모"). 클릭 전 필터링용.
      try {
        const nameToCategory = await searchFrameElement.evaluate(() => {
          const out: Record<string, string> = {};
          const items = document.querySelectorAll("li.VLTHu");
          items.forEach((li) => {
            const nameEl = li.querySelector("span.YwYLL");
            const catEl = li.querySelector("span.YzBgS");
            const name = (nameEl?.textContent ?? "").replace(/\s+/g, " ").trim();
            const category = (catEl?.textContent ?? "")
              .replace(/\s+/g, " ")
              .trim();
            if (name && category && !(name in out)) {
              out[name] = category;
            }
          });
          return out;
        });

        let attached = 0;
        for (const item of result) {
          const cat = nameToCategory[item.name];
          if (cat) {
            item.category = cat;
            attached++;
          }
        }
        log.info(
          `🏷️ category attached to ${attached}/${result.length} list items`
        );
      } catch (e) {
        log.warn(
          `category mapping failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    } else {
      log.warn("Scroll container not found, trying alternative method...");

      // 3. 대체 방법: a.place_bluelink[role="button"] 사용 (lash_scraper_seoul.js 패턴)
      const placeLinks = await searchFrameElement.$$(
        'a.place_bluelink[role="button"]'
      );
      log.info(`Found ${placeLinks.length} place_bluelink elements`);

      for (let i = 0; i < placeLinks.length; i++) {
        try {
          const link = placeLinks[i];
          // span.YwYLL에서 매장명 추출
          const nameSpan = await link.$("span.YwYLL");
          if (nameSpan) {
            const shopName = await nameSpan.textContent();
            if (shopName && shopName.trim().length > 0) {
              const trimmedName = shopName.trim();

              // 광고 관련 텍스트 필터링
              if (
                trimmedName === "광고" ||
                trimmedName.startsWith("광고") ||
                trimmedName.endsWith("광고") ||
                (trimmedName.includes("광고") && trimmedName.length <= 10)
              ) {
                log.debug(`Excluded ad-related text: "${trimmedName}"`);
                continue;
              }

              result.push({ index: i, name: trimmedName });
              log.debug(`Place found: "${trimmedName}"`);
            }
          }
        } catch (e) {
          continue;
        }
      }
    }

    log.info(`Total ${result.length} places collected`);
    return result;
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Error during place collection"
    );

    // 에러가 발생해도 이미 수집된 항목들은 반환
    if (result.length > 0) {
      log.info(
        `Returning ${result.length} already collected places despite error`
      );
      return result;
    }

    return [];
  }
}

export async function clickListItem(
  page: Page,
  idx: number,
  log: Logger
): Promise<boolean> {
  log.info(`Clicking ${idx}th place...`);

  // lash_scraper_seoul.js의 성공적인 패턴으로 iframe 찾기
  const searchFrameElement = await findSearchFrameByUrl(page);
  if (!searchFrameElement) {
    log.warn("Search result iframe not found");
    return false;
  }

  try {
    // 2026-05 네이버 지도 DOM 구조:
    // <li class="VLTHu OW9LQ">
    //   <a class="U70Fj k4f_J"><span class="YwYLL">가게이름</span></a>
    // li 단위로 인덱싱 후, 그 안의 클릭 가능한 a 를 찾아 클릭한다.
    const itemSelectors = [
      "li.VLTHu",
      "li.VLTHu.OW9LQ",
      "li[class*='VLTHu']",
      "li[data-laim-exp-id]",
    ];
    let items: any[] = [];
    let usedItemSelector = "";
    for (const selector of itemSelectors) {
      items = await searchFrameElement.$$(selector);
      if (items.length > 0) {
        usedItemSelector = selector;
        break;
      }
    }
    log.info(
      `🔗 list item selector: "${usedItemSelector}" matched ${items.length} li`
    );

    if (idx >= items.length) {
      log.warn(`❌ ${idx}th element does not exist (total: ${items.length})`);
      return false;
    }

    // li 안의 클릭 가능한 a 후보들 — 새 클래스(U70Fj) 우선, 옛 클래스도 fallback
    const linkCandidates = [
      "a.U70Fj",
      "a.U70Fj.k4f_J",
      "div.DPldi a",
      "a.place_bluelink",
      "a[role='button']",
    ];
    let targetLink: any = null;
    for (const sel of linkCandidates) {
      targetLink = await items[idx].$(sel);
      if (targetLink) break;
    }
    if (!targetLink) {
      log.warn(
        `❌ ${idx}th li does not contain any clickable anchor (tried ${linkCandidates.join(", ")})`
      );
      return false;
    }

    // 요소가 보이는지 확인
    const isVisible = await targetLink.isVisible();
    if (!isVisible) {
      // 스크롤하여 요소를 보이게 만들기
      await targetLink.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    }

    await targetLink.click({ timeout: 10_000 });
    await page.waitForTimeout(700);
    log.info(`✅ ${idx}th place clicked successfully`);
    return true; // 성공 시 true 반환
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error) },
      `❌ Failed to click ${idx}th place`
    );
    return false; // 실패 시 false 반환
  }
}

export async function goToNextPage(page: Page, log: Logger) {
  log.info("Moving to next page...");

  // lash_scraper_seoul.js의 성공적인 패턴으로 iframe 찾기
  const searchFrameElement = await findSearchFrameByUrl(page);
  if (!searchFrameElement) {
    log.warn("Search result iframe not found");
    return false;
  }

  try {
    // lash_scraper_seoul.js 패턴: zRM9F 클래스의 페이지네이션 컨테이너에서 다음 페이지 버튼 찾기
    const paginationContainer = await searchFrameElement.$("div.zRM9F");
    if (!paginationContainer) {
      log.warn("❌ Pagination container (zRM9F) not found");
      return false;
    }

    // 페이지네이션 내의 모든 링크 확인
    const pageLinks = await paginationContainer.$$("a");
    log.debug(`Found ${pageLinks.length} pagination links`);

    // 현재 페이지와 다음 페이지 버튼 찾기 (lash_scraper_seoul.js 패턴)
    let currentPageNumber = 1;
    let nextButton = null;
    let nextPageButton = null;
    let maxPageNumber = 1;

    for (const link of pageLinks) {
      try {
        const classes = await link.getAttribute("class");
        const ariaDisabled = await link.getAttribute("aria-disabled");
        const linkText = await link.textContent();

        log.debug(
          `Link check: class="${classes}", aria-disabled="${ariaDisabled}", text="${linkText}"`
        );

        // 숫자 페이지 버튼 확인 (mBN2s 클래스)
        if (
          classes &&
          classes.includes("mBN2s") &&
          !isNaN(parseInt(linkText || ""))
        ) {
          const pageNum = parseInt(linkText || "");

          // 최대 페이지 번호 업데이트
          if (pageNum > maxPageNumber) {
            maxPageNumber = pageNum;
          }

          // 현재 활성 페이지 확인 (qxokY 클래스가 있으면 현재 페이지)
          if (classes.includes("qxokY")) {
            currentPageNumber = pageNum;
            log.info(`🎯 Current active page found: ${pageNum}페이지`);
          }

          // 다음 페이지 번호 버튼 찾기 (현재 페이지 + 1)
          if (pageNum === currentPageNumber + 1 && ariaDisabled !== "true") {
            nextButton = link;
            log.info(
              `✅ Next number page button found: ${linkText} (current: ${currentPageNumber})`
            );
          }
        }

        // 다음페이지 버튼 찾기 (eUTV2 클래스이고 aria-disabled="false"이고 텍스트가 "다음페이지")
        if (
          classes &&
          classes.includes("eUTV2") &&
          ariaDisabled === "false" &&
          linkText === "다음페이지"
        ) {
          nextPageButton = link;
          log.info(`✅ Next page button found: ${linkText}`);
        }
      } catch (e) {
        continue;
      }
    }

    // 현재 페이지 번호 로깅
    log.info(
      `📍 Current page: ${currentPageNumber}페이지, Max page: ${maxPageNumber}페이지`
    );

    // 현재 페이지가 최대 페이지에 도달했는지 확인
    if (currentPageNumber >= maxPageNumber) {
      log.info(
        `🚫 Already on the last page (${maxPageNumber}), no more pages available`
      );
      return false;
    }

    // 다음 페이지 버튼이 없으면 "다음페이지" 버튼 사용
    if (!nextButton) {
      if (nextPageButton) {
        // 5페이지 이후이거나 다음 숫자 버튼이 없을 때 "다음페이지" 버튼 사용
        nextButton = nextPageButton;
        log.info(
          `📝 Using next page button (current: ${currentPageNumber}페이지)`
        );
      } else {
        // "다음페이지" 버튼이 없음 = 더 이상 페이지가 없음
        log.info(
          `🚫 No more pages available (current page: ${currentPageNumber})`
        );
        return false;
      }
    }

    // 버튼이 클릭 가능한지 확인
    try {
      const isVisible = await nextButton.isVisible();
      const isEnabled = await nextButton.isEnabled();

      if (isVisible && isEnabled) {
        log.info("🖱️ Clicking next page button...");

        // 더 안전한 클릭 방식 사용
        try {
          await nextButton.click({ timeout: 15000 });
          await page.waitForTimeout(5000); // 페이지 로딩 대기 시간 증가

          // 페이지 이동 후 iframe 상태 확인
          try {
            const newContent = await searchFrameElement.evaluate(
              () => document.body.innerHTML.length
            );
            log.debug(`Page content length after navigation: ${newContent}`);
            log.info("✅ Successfully moved to next page");

            // 페이지 이동 후 실제 페이지 번호 확인
            log.info("🔍 Checking actual page number after navigation...");
            await page.waitForTimeout(3000);

            try {
              const actualNextPage = await getCurrentPageNumber(
                searchFrameElement,
                log
              );
              log.info(`📍 Actually moved to page: ${actualNextPage}페이지`);

              // 페이지 번호가 실제로 증가했는지 확인
              if (actualNextPage > currentPageNumber) {
                log.info(
                  `✅ Page navigation successful: ${currentPageNumber} → ${actualNextPage}`
                );
                return true;
              } else {
                log.warn(
                  `⚠️ Page number didn't increase: ${currentPageNumber} → ${actualNextPage}`
                );
                return false;
              }
            } catch (pageCheckError) {
              log.warn(
                `⚠️ Page number check failed, assuming success: ${
                  pageCheckError instanceof Error
                    ? pageCheckError.message
                    : String(pageCheckError)
                }`
              );
              return true;
            }
          } catch (e) {
            log.warn(
              `⚠️ iframe status check failed: ${
                e instanceof Error ? e.message : String(e)
              }`
            );
            return true; // iframe 상태 확인 실패해도 클릭은 성공했으므로 true 반환
          }
        } catch (clickError) {
          log.error(
            `❌ Button click failed: ${
              clickError instanceof Error
                ? clickError.message
                : String(clickError)
            }`
          );
          return false;
        }
      } else {
        log.warn("❌ Next page button is not visible or enabled");
        return false;
      }
    } catch (error) {
      log.error(
        `❌ Button status check failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  } catch (error) {
    log.error(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      "❌ Error moving to next page"
    );
    return false;
  }
}

// 특정 페이지 번호로 이동하는 함수 (lash_scraper_seoul.js 패턴 적용)
export async function goToSpecificPage(
  page: Page,
  targetPage: number,
  log: Logger
) {
  log.info(`🎯 Moving to specific page ${targetPage}...`);

  const searchFrameElement = await findSearchFrameByUrl(page);
  if (!searchFrameElement) {
    log.warn("Search result iframe not found");
    return false;
  }

  try {
    // 현재 페이지 번호 확인
    const currentPageNumber = await getCurrentPageNumber(
      searchFrameElement,
      log
    );
    log.info(
      `📍 Current page: ${currentPageNumber}, Target page: ${targetPage}`
    );

    if (currentPageNumber === targetPage) {
      log.info(`✅ Already on page ${targetPage}`);
      return true;
    }

    if (currentPageNumber > targetPage) {
      log.warn(
        `⚠️ Current page (${currentPageNumber}) is greater than target page (${targetPage})`
      );
      return false;
    }

    // 실제 최대 페이지 수 확인
    const maxPageNumber = await getMaxPageNumber(searchFrameElement, log);
    log.info(`📊 Maximum available page: ${maxPageNumber}`);

    if (targetPage > maxPageNumber) {
      log.warn(
        `⚠️ Target page (${targetPage}) exceeds maximum available page (${maxPageNumber})`
      );
      log.info(
        `🔄 Moving to maximum available page (${maxPageNumber}) instead`
      );
      // 목표 페이지를 최대 페이지로 조정
      targetPage = maxPageNumber;
    }

    // 목표 페이지까지 순차적으로 이동 (lash_scraper_seoul.js 패턴)
    let currentPage = currentPageNumber;
    let attempts = 0;
    const maxAttempts = targetPage - currentPageNumber + 5; // 안전장치

    while (currentPage < targetPage && attempts < maxAttempts) {
      attempts++;
      log.info(
        `📄 Moving from page ${currentPage} to ${
          currentPage + 1
        }... (${attempts}/${maxAttempts})`
      );

      // lash_scraper_seoul.js 패턴: 페이지네이션에서 다음 페이지 버튼 찾기
      const paginationContainer = await searchFrameElement.$("div.zRM9F");
      if (!paginationContainer) {
        log.warn("❌ Pagination container (zRM9F) not found");
        break;
      }

      const pageLinks = await paginationContainer.$$("a");
      let nextPageBtn = null;

      // 다음페이지 버튼 찾기 (eUTV2 클래스이고 aria-disabled="false"이고 텍스트가 "다음페이지")
      for (const link of pageLinks) {
        try {
          const classes = await link.getAttribute("class");
          const ariaDisabled = await link.getAttribute("aria-disabled");
          const linkText = await link.textContent();

          if (
            classes &&
            classes.includes("eUTV2") &&
            ariaDisabled === "false" &&
            linkText === "다음페이지"
          ) {
            nextPageBtn = link;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (nextPageBtn) {
        try {
          await nextPageBtn.click();
          await page.waitForTimeout(5000); // 페이지 로딩 대기

          // 새로운 페이지 번호 확인
          const newCurrentPage = await getCurrentPageNumber(
            searchFrameElement,
            log
          );
          if (newCurrentPage > currentPage) {
            currentPage = newCurrentPage;
            log.info(`✅ Successfully moved to page ${currentPage}`);
          } else {
            log.warn(`⚠️ Page number didn't change, still on ${currentPage}`);
            break;
          }
        } catch (clickError) {
          log.error(
            `❌ Page navigation failed: ${
              clickError instanceof Error
                ? clickError.message
                : String(clickError)
            }`
          );
          break;
        }
      } else {
        log.warn(`❌ Next page button not found on page ${currentPage}`);
        break;
      }
    }

    if (currentPage >= targetPage) {
      log.info(`🎉 Successfully reached target page ${targetPage}`);
      return true;
    } else {
      log.warn(
        `❌ Failed to reach target page ${targetPage}, stopped at ${currentPage}`
      );
      return false;
    }
  } catch (error) {
    log.error(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      `❌ Error moving to page ${targetPage}`
    );
    return false;
  }
}

// 최대 페이지 번호를 가져오는 함수
export async function getMaxPageNumber(
  searchFrame: any,
  log?: Logger
): Promise<number> {
  try {
    if (log) {
      log.info("🔍 최대 페이지 번호 확인 중...");
    } else {
      console.log("🔍 최대 페이지 번호 확인 중...");
    }

    // lash_scraper_seoul.js 패턴: zRM9F 클래스의 페이지네이션 컨테이너에서 확인
    const paginationContainer = await searchFrame.$("div.zRM9F");
    if (!paginationContainer) {
      if (log) {
        log.warn("❌ 페이지네이션 컨테이너(zRM9F)를 찾을 수 없음");
      } else {
        console.warn("❌ 페이지네이션 컨테이너(zRM9F)를 찾을 수 없음");
      }
      return 1; // 기본값
    }

    // lash_scraper_seoul.js 패턴: mBN2s 클래스의 숫자 페이지 버튼들 찾기
    const pageNumbers = await searchFrame.$$eval(
      'a[class*="mBN2s"]',
      (links: Element[]): number[] => {
        const numbers: number[] = [];

        links.forEach((link: Element) => {
          const text = link.textContent?.trim() || "";
          const pageNum = parseInt(text);
          if (!isNaN(pageNum)) {
            numbers.push(pageNum);
          }
        });

        return numbers;
      }
    );

    if (pageNumbers.length === 0) {
      if (log) {
        log.warn("❌ 페이지 번호를 찾을 수 없음");
      } else {
        console.warn("❌ 페이지 번호를 찾을 수 없음");
      }
      return 1; // 기본값
    }

    const maxPage = Math.max(...pageNumbers);

    if (log) {
      log.info(`📊 최대 페이지 번호: ${maxPage}페이지`);
    } else {
      console.log(`📊 최대 페이지 번호: ${maxPage}페이지`);
    }

    return maxPage;
  } catch (error) {
    if (log) {
      log.error(
        `❌ 최대 페이지 번호 확인 실패: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } else {
      console.error(
        `❌ 최대 페이지 번호 확인 실패: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    return 1; // 기본값
  }
}

// 현재 페이지 번호를 가져오는 함수 (lash_scraper_seoul.js 패턴 적용)
export async function getCurrentPageNumber(
  searchFrame: any,
  log?: Logger
): Promise<number> {
  try {
    if (log) {
      log.info("🔍 현재 페이지 번호 확인 중...");
    } else {
      console.log("🔍 현재 페이지 번호 확인 중...");
    }

    // lash_scraper_seoul.js 패턴: zRM9F 클래스의 페이지네이션 컨테이너에서 확인
    const paginationContainer = await searchFrame.$("div.zRM9F");
    if (!paginationContainer) {
      if (log) {
        log.warn("❌ 페이지네이션 컨테이너(zRM9F)를 찾을 수 없음");
      } else {
        console.warn("❌ 페이지네이션 컨테이너(zRM9F)를 찾을 수 없음");
      }
      return 1; // 기본값
    }

    // 페이지 링크 타입 정의
    type PageLink = {
      pageNum: number;
      classes: string;
      ariaDisabled: string | null;
      isActive: boolean;
      index: number;
      text: string;
    };

    // lash_scraper_seoul.js 패턴: mBN2s 클래스의 숫자 페이지 버튼들 찾기
    const pageLinks = await searchFrame.$$eval(
      'a[class*="mBN2s"]',
      (links: Element[]): PageLink[] => {
        const results: PageLink[] = [];

        links.forEach((link: Element, index: number) => {
          const text = link.textContent?.trim() || "";
          const classes = (link as HTMLElement).className || "";
          const ariaDisabled = (link as HTMLElement).getAttribute(
            "aria-disabled"
          );

          // 숫자 페이지 버튼만 필터링
          const pageNum = parseInt(text);
          if (!isNaN(pageNum)) {
            const isActive = classes.includes("qxokY"); // lash_scraper_seoul.js에서 확인된 활성 페이지 클래스
            results.push({
              pageNum,
              classes,
              ariaDisabled,
              isActive,
              index,
              text,
            });
          }
        });

        return results;
      }
    );

    if (log) {
      log.info(`📊 총 ${pageLinks.length}개 페이지 버튼 발견`);
    } else {
      console.log(`📊 총 ${pageLinks.length}개 페이지 버튼 발견`);
    }

    // lash_scraper_seoul.js 패턴: qxokY 클래스가 있는 현재 활성 페이지 찾기
    const activePage = pageLinks.find((link: PageLink) => link.isActive);
    if (activePage) {
      if (log) {
        log.info(`✅ 현재 활성 페이지 발견: ${activePage.pageNum}페이지`);
      } else {
        console.log(`✅ 현재 활성 페이지 발견: ${activePage.pageNum}페이지`);
      }
      return activePage.pageNum;
    }

    // 활성 페이지가 없으면 디버깅 정보 출력
    if (log) {
      log.warn("⚠️ 활성 페이지를 찾을 수 없음, 모든 페이지 정보:");
      pageLinks.forEach((link: PageLink) => {
        log.debug(
          `📄 ${link.pageNum}페이지: classes="${link.classes}", active=${link.isActive}`
        );
      });
    } else {
      console.warn("⚠️ 활성 페이지를 찾을 수 없음, 모든 페이지 정보:");
      pageLinks.forEach((link: PageLink) => {
        console.log(
          `📄 ${link.pageNum}페이지: classes="${link.classes}", active=${link.isActive}`
        );
      });
    }

    // 기본값 1 반환
    if (log) {
      log.info("🔄 기본값 1페이지 반환");
    } else {
      console.log("🔄 기본값 1페이지 반환");
    }
    return 1;
  } catch (error) {
    if (log) {
      log.error(
        `❌ 현재 페이지 번호 확인 실패: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } else {
      console.error(
        `❌ 현재 페이지 번호 확인 실패: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    return 1; // 기본값
  }
}
