export interface Secrets {
  url: string;
  anonKey: string;
  serviceKey?: string;
  table: string;
  /** Google Chat incoming webhook URL (key + token 포함). 안전 저장. */
  chatWebhookUrl?: string;
}

export interface SecretsLoadResponse {
  url: string;
  anonKey: string;
  table: string;
  hasServiceKey: boolean;
  encryptionAvailable: boolean;
  /** webhook URL 자체는 노출하지 않고 설정 여부만 boolean 으로 전달 */
  hasChatWebhook: boolean;
}

export type CrawlMode = "single" | "all_korea";

export interface CrawlStartPayload {
  mode: CrawlMode;
  keyword: string;
  /** 단일 모드일 때 필수, all_korea 모드에서는 시작 위치 힌트(미지정 시 첫 위치) */
  city?: string;
  district?: string;
  dong?: string;
  headful: boolean;
  slowMo: number;
  /** 대표메뉴 수집 여부. 기본 true. */
  collectMenu?: boolean;
  /** 사용자 정의 추가 카테고리 단어. 카테고리에 포함되면 매칭으로 인정. */
  extraCategoryKeywords?: string[];
  resume: boolean;
}

export interface SessionState {
  mode: CrawlMode;
  keyword: string;
  /** 현재 처리 중이거나 마지막으로 처리한 위치 */
  city: string;
  district: string;
  dong: string;
  page: number;
  listIndex: number;
  processed: number;
  /** all_korea 모드용 인덱스 (단일 모드에서는 0) */
  cityIndex?: number;
  districtIndex?: number;
  dongIndex?: number;
  status: "running" | "stopped" | "completed" | "error";
  updatedAt: string;
  error?: string;
}

export interface ProgressEvent {
  sessionId: string;
  page: number;
  listIndex: number;
  processed: number;
}

export interface LogEvent {
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  msg: string;
  time: number;
  ctx?: Record<string, unknown>;
}

export interface DoneEvent {
  sessionId: string;
  ok: boolean;
  error?: string;
}

export function makeSessionKey(p: {
  mode?: CrawlMode;
  keyword: string;
  city?: string;
  district?: string;
  dong?: string;
}) {
  if (p.mode === "all_korea") return `${p.keyword}|ALL_KOREA`;
  return `${p.keyword}|${p.city ?? ""}|${p.district ?? ""}|${p.dong ?? ""}`;
}
