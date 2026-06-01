/**
 * 페이지 구조 검증(assert) 유틸.
 *
 * 동영님 조언: 예상 페이지 구조(클래스명/계층)를 엄밀히 검사하고 불만족 시 실패 처리.
 * 자동화 스크래핑에선 위양성(정상인데 실패)보다 위음성(데이터 있는데 0건 처리)이 치명적.
 * → 구조가 깨졌는지 확신이 없으면 조용히 [] 를 반환하지 말고 throw 한다.
 *
 * 빨래방 1400건 누락 = collectListItems 가 search iframe 을 못 찾고도 [] 를 반환해
 * soft block 을 "빈 동"으로 오인한 것이 근본 원인.
 */

export const STRUCTURE_ASSERT_PREFIX = "STRUCTURE_ASSERT";

export class StructureAssertError extends Error {
  readonly what: string;
  readonly detail?: unknown;

  constructor(what: string, detail?: unknown) {
    super(`${STRUCTURE_ASSERT_PREFIX}: ${what}`);
    this.name = "StructureAssertError";
    this.what = what;
    this.detail = detail;
  }
}

/** 조건이 false 면 StructureAssertError 를 던진다. */
export function assertStructure(
  cond: boolean,
  what: string,
  detail?: unknown
): asserts cond {
  if (!cond) throw new StructureAssertError(what, detail);
}

/** runner 의 에러 분기에서 사용 — StructureAssertError 인지 판정 (직렬화돼 message 만 남은 경우 포함). */
export function isStructureAssertError(err: unknown): err is StructureAssertError {
  if (err instanceof StructureAssertError) return true;
  return (
    err instanceof Error &&
    err.message.startsWith(`${STRUCTURE_ASSERT_PREFIX}:`)
  );
}
