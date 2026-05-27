import type { PlaceInfo, ScrapedPlaceInfo } from "./place.js";

export interface MarkMissingResult {
  /** missing 으로 표시된 행 수 */
  count: number;
}

export interface IPlaceRepo {
  upsert(place: PlaceInfo | ScrapedPlaceInfo): Promise<void>;
  flush?(): Promise<void>;
  /**
   * 동 단위로 "마지막으로 본 지 daysThreshold 일 지난 active 가게"를 missing 으로 표시.
   * lifecycle 컬럼이 있는 테이블(_v2)만 처리, 그 외는 no-op.
   */
  markDongMissing?(args: {
    district: string;
    dong: string;
    daysThreshold: number;
  }): Promise<MarkMissingResult>;
}
