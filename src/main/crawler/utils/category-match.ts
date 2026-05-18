// 검색 키워드별 카테고리 alias 맵.
// 카테고리 텍스트(예: "왁싱,제모")가 alias 중 하나라도 포함하면 매칭으로 본다.
// 새 키워드를 추가할 때는 lowercase 키로 등록.
const CATEGORY_ALIASES: Record<string, string[]> = {
  왁싱: ["왁싱", "제모"],
  제모: ["왁싱", "제모"],
  속눈썹: ["속눈썹", "래쉬", "아이래쉬"],
  래쉬: ["속눈썹", "래쉬", "아이래쉬"],
  네일: ["네일", "매니큐어", "페디큐어", "네일아트"],
  헬스장: ["헬스", "피트니스", "짐", "gym", "크로스핏"],
  헬스: ["헬스", "피트니스", "짐", "gym", "크로스핏"],
  피트니스: ["헬스", "피트니스", "짐", "gym", "크로스핏"],
  필라테스: ["필라테스", "요가"],
  요가: ["요가", "필라테스"],
  미용실: ["미용실", "헤어", "헤어샵", "헤어살롱", "이용원"],
  헤어: ["미용실", "헤어", "헤어샵", "헤어살롱"],
  꽃집: ["꽃집", "플로리스트", "플라워", "화원"],
  카페: ["카페", "커피", "디저트"],
  치과: ["치과", "치과의원", "교정치과"],
};

/**
 * 검색 키워드와 카테고리 텍스트가 매칭되는지 검사.
 *
 * - category가 비어있으면 true(통과). 리스트에서 카테고리를 못 긁어온 경우는
 *   detail 단계에서 한 번 더 거르거나 사용자에게 노출되도록 일단 통과시킨다.
 * - 키워드가 카테고리에 substring으로 포함되면 매칭.
 * - 사용자 정의 extraKeywords 중 하나라도 substring으로 포함되면 매칭.
 * - alias 맵에 등록된 키워드는 alias 중 하나라도 카테고리에 포함되면 매칭.
 * - 셋 다 실패하면 미스매치.
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

  const aliases = CATEGORY_ALIASES[kw];
  if (aliases && aliases.some((a) => cat.includes(a.toLowerCase()))) {
    return true;
  }

  return false;
}
