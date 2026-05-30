import type { Page } from "playwright";

/** [min, max) 범위의 정수 ms 난수 */
export function randMs(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

/**
 * 사람처럼 보이도록 랜덤 지터만큼 대기한다.
 * 고정 waitForTimeout 은 기계적 패턴이라 봇 탐지에 취약하므로 모든 주요 대기는 이걸로.
 */
export async function humanDelay(
  page: Page,
  min: number,
  max: number
): Promise<void> {
  await page.waitForTimeout(randMs(min, max));
}
