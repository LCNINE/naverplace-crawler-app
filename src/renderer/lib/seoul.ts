import { SEOUL_DISTRICTS } from "../../main/crawler/config/seoul-data.js";

export const SEOUL = SEOUL_DISTRICTS as Record<string, string[]>;
export const SEOUL_DISTRICT_NAMES = Object.keys(SEOUL);

export const CITIES = ["서울"];
