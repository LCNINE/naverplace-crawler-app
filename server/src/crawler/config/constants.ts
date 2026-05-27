import {
  KOREA_CITIES,
  CITY_NAMES,
  SEOUL_DISTRICTS,
  DISTRICT_NAMES,
} from "./korea-data.js";

export { KOREA_CITIES, CITY_NAMES, SEOUL_DISTRICTS, DISTRICT_NAMES };
export type District = keyof typeof SEOUL_DISTRICTS;
export type City = keyof typeof KOREA_CITIES;
