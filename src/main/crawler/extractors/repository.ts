import type { PlaceInfo, ScrapedPlaceInfo } from "./place.js";

export interface IPlaceRepo {
  upsert(place: PlaceInfo | ScrapedPlaceInfo): Promise<void>;
  flush?(): Promise<void>;
}
