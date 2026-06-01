/**
 * 검색 키워드와 카테고리 텍스트가 매칭되는지 검사.
 *
 * - category가 비어있으면 true(통과). 리스트에서 카테고리를 못 긁어온 경우는
 *   detail 단계에서 한 번 더 거르거나 사용자에게 노출되도록 일단 통과시킨다.
 * - 키워드가 카테고리에 substring으로 포함되면 매칭.
 * - 사용자 정의 extraKeywords 중 하나라도 substring으로 포함되면 매칭.
 * - 둘 다 실패하면 미스매치(skip).
 *
 * 예) keyword="빨래방", extraKeywords=[]       → 카테고리에 "빨래방"이 포함된 곳만 크롤링
 *     keyword="빨래방", extraKeywords=["셀프"]  → "셀프"가 포함된 카테고리도 추가로 크롤링
 *
 * (이전의 CATEGORY_ALIASES 자동 별칭 매핑은 제거됨 — 매칭은 오직 검색어 + extraKeywords 로만 결정한다.)
 */
export function matchesCategory(
  keyword: string,
  category: string | undefined | null,
  extraKeywords: string[] = []
): boolean {
  const cat = (category ?? "").trim().toLowerCase();
  if (!cat) return true;

  const kw = keyword.trim().toLowerCase();
  if (!kw) return true;

  if (cat.includes(kw)) return true;

  for (const extra of extraKeywords) {
    const e = extra.trim().toLowerCase();
    if (e && cat.includes(e)) return true;
  }

  return false;
}
