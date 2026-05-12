import type { Page } from "playwright";
import { Logger } from "../logging/logger.js";
import { entryFrame } from "../utils/selectors.js";
import {
  extractDongFromAddress,
  normalizeText,
  ScrapedPlaceInfo,
} from "../extractors/place.js";

export async function extractDetail(
  page: Page,
  ctx: {
    city: string;
    district: string;
    dong: string;
    pageNo: number;
    listIndex: number;
    shopName: string;
  },
  log: Logger
): Promise<ScrapedPlaceInfo> {
  // lash_scraper_seoul.js와 동일: 새로운 entryIframe이 로드될 때까지 대기
  log.info("⏳ Waiting for new entryIframe to load...");

  let f = null;
  let retryCount = 0;
  const maxRetries = 3;

  while (!f && retryCount < maxRetries) {
    try {
      // 새로운 entryIframe 로딩 대기
      await page.waitForFunction(
        () => {
          const frames = document.querySelectorAll("iframe");
          for (const frame of frames) {
            if (
              frame.id === "entryIframe" ||
              (frame.src.includes("/place/") && frame.src.includes("entry=")) ||
              (frame.src.includes("/Lashshop/") && frame.src.includes("entry="))
            ) {
              return true;
            }
          }
          return false;
        },
        { timeout: 5000 }
      );

      // entryIframe 찾기
      f = entryFrame(page);

      // entryIframe이 제대로 로드되었는지 확인
      try {
        const frameElement = await page.$("#entryIframe");
        if (frameElement) {
          const contentFrame = await frameElement.contentFrame();
          if (contentFrame) {
            const hasContent = await contentFrame
              .evaluate(() => {
                return document.querySelectorAll("*").length > 100;
              })
              .catch(() => false);

            if (hasContent) {
              log.info("✅ New entryIframe loaded successfully");
              break;
            }
          }
        }
        log.debug(
          `EntryIframe content check failed (attempt ${retryCount + 1})`
        );
        f = null;
      } catch (e) {
        log.debug(
          `EntryIframe content check failed: ${e instanceof Error ? e.message : String(e)
          }`
        );
        f = null;
      }
    } catch (e) {
      log.debug(
        `EntryIframe loading attempt ${retryCount + 1} failed: ${e instanceof Error ? e.message : String(e)
        }`
      );
    }

    retryCount++;
    if (retryCount < maxRetries) {
      await page.waitForTimeout(2000);
    }
  }

  if (!f) {
    log.error("❌ Failed to load entryIframe after all retries");
    throw new Error("EntryIframe loading failed");
  }

  // 주요 요소가 렌더링될 때까지 추가 대기
  try {
    await f
      .locator("span.GHAhO, span.lnJFt, img#business_1, img[alt='업체']")
      .first()
      .waitFor({ timeout: 10000 });
  } catch (e) {
    log.debug(
      `Key selectors not found within timeout: ${e instanceof Error ? e.message : String(e)
      }`
    );
  }

  // lash_scraper_seoul.js와 동일한 로직: 이미 수집된 shopName 사용
  // (스크롤 작업에서 span.YwYLL로 확실하게 수집했으므로 iframe에서 다시 추출할 필요 없음)
  let shop_name = "";
  try {
    const nameElement = await f.locator("span.GHAhO").first();
    if ((await nameElement.count()) > 0) {
      shop_name = normalizeText(await nameElement.textContent());
      log.info(`✅ Shop name extracted from entryIframe: "${shop_name}"`);
    } else {
      // GHAhO 클래스가 없으면 다른 선택자 시도
      const fallbackName = await f
        .locator("h1.place_bluelink, h1.header, .place_bluelink.tit")
        .first()
        .textContent()
        .catch(() => "");

      if (fallbackName) {
        shop_name = normalizeText(fallbackName);
        log.info(
          `✅ Shop name extracted from fallback selector: "${shop_name}"`
        );
      } else {
        // 모든 방법이 실패하면 컨텍스트의 이름 사용 (경고와 함께)
        shop_name = normalizeText(ctx.shopName);
        log.warn(`⚠️ Using fallback shop name from context: "${shop_name}"`);
      }
    }
  } catch (error) {
    log.warn(
      `⚠️ Failed to extract shop name from entryIframe: ${error instanceof Error ? error.message : String(error)
      }`
    );
    shop_name = normalizeText(ctx.shopName);
    log.info(`✅ Using shop name from context as fallback: "${shop_name}"`);
  }
  const addressCandidates = (
    await f
      .locator(
        '[data-testid*="address"], .LDgIH, .O8qbU.tQY7D a, .O8qbU.tQY7D span'
      )
      .allTextContents()
      .catch(() => [])
  )
    .map((text) => normalizeText(text))
    .filter((text) => {
      if (text.length === 0) return false;
      if (text === "주소") return false;
      if (text === "도로명") return false;
      if (text === "지번") return false;
      if (text === "복사") return false;
      return true;
    });

  const address = addressCandidates[0] ?? "";
  // 주소 드롭다운이 닫혀 있으면 클릭해서 지번 노출
  try {
    const addressToggle = f
      .locator("a.PkgBl, button.PkgBl, .PkgBl[role='button']")
      .first();
    if ((await addressToggle.count()) > 0) {
      await addressToggle.click();
      await page.waitForTimeout(800);
      await f
        .locator("div.Y31Sf div.nQ7Lh", { hasText: "지번" })
        .first()
        .waitFor({ timeout: 3000 })
        .catch(() => undefined);
    }
  } catch (e) {
    // 토글 실패는 무시
  }

  let jibunAddress = "";
  try {
    const jibunLocator = f
      .locator("div.Y31Sf div.nQ7Lh", { hasText: "지번" })
      .first();
    if ((await jibunLocator.count()) > 0) {
      const text = normalizeText(await jibunLocator.textContent());
      jibunAddress = text.replace(/^지번/, "").replace(/복사/g, "").trim();
    }
  } catch (e) {
    // ignore
  }

  if (!jibunAddress) {
    jibunAddress = await f
      .locator("body")
      .evaluate(() => {
        const clean = (text?: string | null) =>
          (text ?? "").replace(/\s+/g, " ").trim();
        const label = Array.from(
          document.querySelectorAll("span.TjXg1")
        ).find((node) => clean(node.textContent) === "지번");
        if (!label) return "";
        const container = label.closest("div");
        if (!container) return "";
        const text = clean(container.textContent);
        return text.replace(/^지번/, "").replace(/복사/g, "").trim();
      })
      .catch(() => "");
  }

  const dongFromJibun = extractDongFromAddress(jibunAddress);
  const dongFromAddress =
    dongFromJibun ||
    (jibunAddress
      ? undefined
      : extractDongFromAddress(address) ||
      addressCandidates.map(extractDongFromAddress).find(Boolean));
  // 전화번호 추출 (lash_scraper_seoul.js의 성공적인 패턴 사용)
  let phone = "";

  // 1. 먼저 일반적인 전화번호 선택자에서 추출 시도
  try {
    const phoneElement = await f
      .locator('a[href^="tel:"], .xlx7Q, .O8qbU.nbXkr .xlx7Q')
      .first();
    if ((await phoneElement.count()) > 0) {
      phone = normalizeText(await phoneElement.textContent());
      if (phone && phone.trim().length > 0) {
        log.info(`✅ Phone extracted from standard selector: "${phone}"`);
      }
    }
  } catch (e) {
    log.debug(
      `Standard phone extraction failed: ${e instanceof Error ? e.message : String(e)
      }`
    );
  }

  // 2. 일반 선택자에서 실패하면 wHa0T 클래스 아이콘 클릭 시도 (lash_scraper_seoul.js 패턴)
  if (!phone || phone.trim().length === 0) {
    try {
      log.info("⏳ Phone not found, trying wHa0T info icon click...");

      // class="wHa0T" svg 태그 찾기
      const infoIcon = await f.locator("svg.wHa0T").first();
      if ((await infoIcon.count()) > 0) {
        log.info("✅ Info icon found! Clicking...");
        await infoIcon.click();
        await page.waitForTimeout(8000); // lash_scraper_seoul.js와 동일한 대기 시간

        // class="J7eF_" div 안의 em 태그에서 전화번호 추출
        const phoneElement = await f.locator(".J7eF_ em").first();
        if ((await phoneElement.count()) > 0) {
          const phoneText = await phoneElement.textContent();
          if (phoneText) {
            phone = normalizeText(phoneText);
            log.info(`📞 Phone extracted from info icon: "${phone}"`);
          }
        } else {
          log.warn("❌ Could not find phone in J7eF_ div em tag");
        }
      } else {
        log.warn("❌ Info icon (wHa0T) not found");
      }
    } catch (wHa0TError) {
      log.debug(
        `wHa0T class processing failed: ${wHa0TError instanceof Error ? wHa0TError.message : String(wHa0TError)
        }`
      );
    }
  }

  // 3. 모든 방법이 실패하면 빈 문자열
  if (!phone || phone.trim().length === 0) {
    phone = "";
    log.warn("⚠️ Could not extract phone number from any method");
  }

  // 영업시간 추출 (lash_scraper_seoul.js 패턴)
  const business_hours = normalizeText(
    await f
      .locator(".O8qbU.pSavy")
      .first()
      .textContent()
      .catch(() => "")
  );

  // 웹사이트 링크들 추출
  const linkElements = await f
    .locator(".O8qbU.yIPfO a")
    .all()
    .catch(() => []);
  const links: string[] = [];
  for (const link of linkElements) {
    const href = await link.getAttribute("href").catch(() => null);
    if (href) links.push(href);
  }

  // 대표 이미지 추출 (locator 우선)
  let image = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const imgLocator = f
      .locator(
        "a.place_thumb img#business_1, img#business_1, img[alt='업체'], img.K0PDV._div"
      )
      .first();
    try {
      await imgLocator.waitFor({ timeout: 5000 });
      const src = await imgLocator.getAttribute("src");
      const dataSrc = await imgLocator.getAttribute("data-src");
      image = normalizeText(src || dataSrc || "");
    } catch (e) {
      image = "";
    }

    if (!image) {
      image = normalizeText(
        await f
          .locator("body")
          .evaluate(() => {
            const candidates: string[] = [];
            const push = (value?: string | null) => {
              const v = value?.trim();
              if (!v) return;
              candidates.push(v);
            };

            const isValid = (url: string) =>
              /pstatic\.net|phinf\.naver\.net/.test(url) &&
              !/sprite|icon|logo|svg/.test(url);

            const mainThumb = document.querySelector(
              "img#business_1, img#business_0, img#business_2, img.K0PDV__div, img.K0PDV._div, img[alt='업체']"
            ) as HTMLImageElement | null;
            if (mainThumb) {
              push(mainThumb.getAttribute("src"));
              push(mainThumb.getAttribute("data-src"));
            }

            for (const img of Array.from(document.querySelectorAll("img"))) {
              push(img.getAttribute("src"));
              push(img.getAttribute("data-src"));
              const srcset = img.getAttribute("srcset");
              if (srcset) {
                srcset
                  .split(",")
                  .map((part) => part.trim().split(" ")[0])
                  .forEach((url) => push(url));
              }
            }

            for (const el of Array.from(
              document.querySelectorAll<HTMLElement>(
                '[style*="background-image"]'
              )
            )) {
              const style = el.style.backgroundImage || "";
              const match = style.match(/url\(["']?(.*?)["']?\)/);
              if (match) push(match[1]);
            }

            const filtered = candidates.filter(isValid);
            if (filtered.length === 0) return "";

            const preferred =
              filtered.find((url) => /w1500|w1200|type=w/.test(url)) ??
              filtered[0];
            return preferred;
          })
          .catch(() => "")
      );
    }

    if (image) break;
    await page.waitForTimeout(1200);
  }

  const categoryMainFromTitle = normalizeText(
    await f
      .locator("#_title span.lnJFt, #_title span[class*='category']")
      .first()
      .textContent()
      .catch(() => "")
  );

  // 메뉴 탭이 열려 있지 않으면 시도 (대표메뉴 수집용)
  try {
    // 메뉴 섹션이 보이도록 스크롤 (지연 로딩 대응)
    await f
      .locator("body")
      .evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      })
      .catch(() => undefined);
    await page.waitForTimeout(500);

    const menuSection = f
      .locator("div.place_section:has(h2:has-text('메뉴'))")
      .first();
    if ((await menuSection.count()) > 0) {
      await menuSection.scrollIntoViewIfNeeded().catch(() => undefined);
      await page.waitForTimeout(500);
    }

    // 상단 탭의 "메뉴" 탭 클릭하여 메뉴 페이지로 이동
    const menuTab = f.locator(
      "a[role='tab'][href*='/menu']:has-text('메뉴'), a._tab-menu[href*='/menu']:has-text('메뉴')"
    );
    if ((await menuTab.count()) > 0) {
      // 이미 메뉴 탭이 선택되어 있는지 확인
      const isSelected = await menuTab.first().getAttribute("aria-selected").catch(() => null);
      if (isSelected !== "true") {
        log.info("🔍 상단 메뉴 탭 클릭하여 메뉴 페이지로 이동...");
        await menuTab.first().click();
        await page.waitForTimeout(2000);
        // 메뉴 리스트가 로드될 때까지 대기
        await f
          .locator("li.E2jtL")
          .first()
          .waitFor({ timeout: 5000 })
          .catch(() => undefined);
        log.info("✅ 메뉴 페이지 로드 완료");
      } else {
        log.info("✅ 이미 메뉴 탭이 선택되어 있음");
      }
    } else {
      log.debug("메뉴 탭을 찾을 수 없음, 현재 페이지에서 메뉴 수집 시도");
    }
  } catch (e) {
    log.debug(
      `메뉴 페이지 이동 실패: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  // 카테고리/태그/대표메뉴 추출 (렌더링 지연 대비 재시도)
  let categories: string[] = [];
  let tags: string[] = [];
  let mainMenu = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    // locator로 메뉴 수집 (가격이 0원이 아닌 메뉴만)
    try {
      // 전체 메뉴 페이지의 li.E2jtL 우선 시도
      let menuItems = f.locator("li.E2jtL");
      let itemCount = await menuItems.count();

      // E2jtL이 없으면 기존 BLsus로 fallback
      if (itemCount === 0) {
        menuItems = f.locator(
          "div.place_section:has(h2:has-text('메뉴')) li.BLsus"
        );
        itemCount = await menuItems.count();
      }
      if (itemCount === 0) {
        menuItems = f.locator("li.BLsus");
        itemCount = await menuItems.count();
      }

      const menuNames: string[] = [];

      for (let i = 0; i < itemCount; i++) {
        const item = menuItems.nth(i);

        // 메뉴명 추출 (span.lPzHi 또는 span.JfbYN)
        let name = normalizeText(
          await item.locator("span.lPzHi").first().textContent().catch(() => "")
        );
        if (!name) {
          name = normalizeText(
            await item.locator("span.JfbYN").first().textContent().catch(() => "")
          );
        }
        if (!name) continue;

        // 가격 확인 (무료/0원 제외)
        const priceText = normalizeText(
          await item
            .locator("div.VnGiV, div.GXS1X, em")
            .first()
            .textContent()
            .catch(() => "")
        );

        // 0원이거나 무료인 경우 제외
        if (
          priceText.includes("무료") ||
          priceText === "0원" ||
          priceText === "0" ||
          /^0\s*원$/.test(priceText)
        ) {
          continue;
        }

        menuNames.push(name);
      }

      if (menuNames.length > 0) {
        const unique = Array.from(new Set(menuNames));
        mainMenu = unique.slice(0, 10).join("/");
        log.info(`✅ 메뉴 수집 완료 (${menuNames.length}개): ${mainMenu}`);
        break; // 성공하면 루프 탈출
      } else {
        log.debug(`메뉴를 찾지 못함 (시도 ${attempt + 1}/3)`);
      }
    } catch (e) {
      log.debug(
        `메뉴 수집 실패 (시도 ${attempt + 1}/3): ${e instanceof Error ? e.message : String(e)
        }`
      );
    }

    const result = await f
      .locator("body")
      .evaluate(() => {
        const clean = (text?: string | null) =>
          (text ?? "").replace(/\s+/g, " ").trim();
        const excluded = new Set([
          "전화",
          "주소",
          "길찾기",
          "홈",
          "예약",
          "주차",
          "영업시간",
          "메뉴",
          "대표메뉴",
          "사진",
          "리뷰",
        ]);

        const pickTexts = (nodes: Element[]) =>
          nodes
            .map((node) => clean(node.textContent))
            .filter(
              (text) =>
                text.length > 0 &&
                text.length <= 30 &&
                !excluded.has(text)
            );

        const categorySelectors = [
          "span.lnJFt",
          "span.YzBgS",
          "span.DJJ",
          "span.DJJl",
          "span[class*='category']",
          "a[class*='category']",
          "span[class*='Category']",
          "a[href*='/category']",
        ];

        const tagSelectors = [
          "span[class*='tag']",
          "a[class*='tag']",
          "a[href*='/tag']",
        ];

        const categoriesSet = new Set<string>();
        const tagsSet = new Set<string>();

        for (const selector of categorySelectors) {
          const nodes = Array.from(document.querySelectorAll(selector));
          pickTexts(nodes).forEach((text) => categoriesSet.add(text));
        }

        for (const selector of tagSelectors) {
          const nodes = Array.from(document.querySelectorAll(selector));
          pickTexts(nodes)
            .map((text) => text.replace(/^#/, ""))
            .forEach((text) => tagsSet.add(text));
        }

        // 메뉴 추출 (가격이 0원이 아닌 메뉴만)
        let mainMenu = "";

        // 1. 전체 메뉴 페이지에서 메뉴 찾기 (li.E2jtL)
        const menuListItems = Array.from(
          document.querySelectorAll("li.E2jtL")
        );

        const collectedMenuNames: string[] = [];

        if (menuListItems.length > 0) {
          menuListItems.forEach((item) => {
            // 메뉴명 추출 (span.lPzHi 또는 span.JfbYN)
            const nameEl = item.querySelector("span.lPzHi, span.JfbYN");
            const priceEl = item.querySelector("div.VnGiV, div.GXS1X, em");
            const name = clean(nameEl?.textContent);
            const price = clean(priceEl?.textContent);

            if (!name) return;
            if (name.length === 0 || name.length > 50) return;
            if (/^[0-9,]+원$/.test(name)) return;
            if (excluded.has(name)) return;

            // 0원이거나 무료인 경우 제외
            if (price.includes("무료")) return;
            if (price === "0원" || price === "0") return;
            if (price.replace(/\s+/g, "") === "0원") return;

            collectedMenuNames.push(name);
          });

          if (collectedMenuNames.length > 0) {
            const unique = Array.from(new Set(collectedMenuNames));
            mainMenu = unique.slice(0, 10).join("/");
          }
        }

        // 2. E2jtL이 없으면 기존 BLsus 방식으로 fallback
        if (!mainMenu) {
          const menuItems = Array.from(
            document.querySelectorAll("li.BLsus")
          );
          const menuNames = menuItems
            .map((item) => {
              const nameEl = item.querySelector("span.JfbYN");
              const priceEl = item.querySelector("div.VnGiV");
              const name = clean(nameEl?.textContent);
              const price = clean(priceEl?.textContent);
              if (!name) return "";
              if (price.includes("무료")) return "";
              if (price.replace(/\s+/g, "") === "0원") return "";
              return name;
            })
            .filter(
              (text) =>
                text.length > 0 &&
                text.length <= 30 &&
                !/[0-9]+원/.test(text) &&
                !excluded.has(text)
            );

          if (menuNames.length > 0) {
            const unique = Array.from(new Set(menuNames));
            mainMenu = unique.slice(0, 10).join("/");
          }
        }

        if (!mainMenu) {
          const menuLabels = Array.from(
            document.querySelectorAll("span, strong, h2, h3")
          ).filter((node) => clean(node.textContent) === "대표메뉴");

          if (menuLabels.length > 0) {
            const container = menuLabels[0].parentElement;
            if (container) {
              const menuCandidates = Array.from(
                container.querySelectorAll("li, span, a, div")
              )
                .map((node) => clean(node.textContent))
                .filter(
                  (text) =>
                    text.length > 0 &&
                    text.length <= 30 &&
                    !/[0-9]+원/.test(text) &&
                    !excluded.has(text)
                );
              if (menuCandidates.length > 0) {
                mainMenu = menuCandidates[0];
              }
            }
          }
        }

        if (!mainMenu && tagsSet.size > 0) {
          const tagWithSlash = Array.from(tagsSet).find((tag) =>
            tag.includes("/")
          );
          if (tagWithSlash) mainMenu = tagWithSlash;
        }

        return {
          categories: Array.from(categoriesSet),
          tags: Array.from(tagsSet),
          mainMenu,
        };
      })
      .catch(() => ({ categories: [], tags: [], mainMenu: "" }));

    categories = result.categories;
    tags = result.tags;
    if (!mainMenu) {
      mainMenu = result.mainMenu;
    }

    if (categories.length > 0 || tags.length > 0 || mainMenu) break;
    await page.waitForTimeout(1200);
  }

  // URL에서 place_id 추출 (Python 코드 참고)
  let place_id: string | undefined;
  try {
    // 현재 페이지의 URL 가져오기
    const currentUrl = await page.url();
    log.debug(`Current page URL: ${currentUrl}`);

    // /place/숫자 패턴 찾기
    let placeIdMatch = currentUrl.match(/\/place\/(\d+)/);
    if (placeIdMatch) {
      place_id = placeIdMatch[1];
      log.info(`✅ Place ID extracted from /place/ pattern: ${place_id}`);
    } else {
      // id=숫자 패턴 찾기
      placeIdMatch = currentUrl.match(/[?&]id=(\d+)/);
      if (placeIdMatch) {
        place_id = placeIdMatch[1];
        log.info(`✅ Place ID extracted from id= pattern: ${place_id}`);
      } else {
        log.warn(`⚠️ URL에서 플레이스 ID 패턴을 찾을 수 없음: ${currentUrl.substring(0, 100)}...`);
      }
    }

    // 현재 URL에서 찾지 못한 경우, 모든 iframe의 URL도 확인
    if (!place_id) {
      const frames = page.frames();
      for (const frame of frames) {
        try {
          const frameUrl = frame.url();
          log.debug(`Checking frame URL: ${frameUrl}`);

          // /place/숫자 패턴 찾기
          placeIdMatch = frameUrl.match(/\/place\/(\d+)/);
          if (placeIdMatch) {
            place_id = placeIdMatch[1];
            log.info(`✅ Place ID extracted from frame URL /place/ pattern: ${place_id}`);
            break;
          }

          // id=숫자 패턴 찾기
          placeIdMatch = frameUrl.match(/[?&]id=(\d+)/);
          if (placeIdMatch) {
            place_id = placeIdMatch[1];
            log.info(`✅ Place ID extracted from frame URL id= pattern: ${place_id}`);
            break;
          }
        } catch (frameError) {
          continue;
        }
      }
    }
  } catch (e) {
    log.warn(`⚠️ URL 추출 실패: ${e instanceof Error ? e.message : String(e)}`);
  }

  const info: ScrapedPlaceInfo = {
    shop_name,
    place_id,
    address: address || undefined,
    phone: phone || undefined,
    business_hours: business_hours || undefined,
    links: links.length > 0 ? links.join(";") : undefined,
    city: ctx.city,
    district: ctx.district,
    dong: dongFromAddress || ctx.dong,
    image: image || undefined,
    category_main: categoryMainFromTitle || categories[0] || undefined,
    category_sub:
      categories.length > 1 ? categories.slice(1).join("/") : undefined,
    main_menu: mainMenu || undefined,
    tags: tags.length > 0 ? tags.join(",") : undefined,
    page: ctx.pageNo,
    scraped_at: new Date().toISOString(),
  };

  log.info(
    {
      shop_name,
      image: info.image,
      category_main: info.category_main,
      dong: info.dong,
      main_menu: info.main_menu,
      jibun: jibunAddress,
    },
    "detail.fields"
  );

  log.info({ shop_name }, "detail.extracted");
  return info;
}
