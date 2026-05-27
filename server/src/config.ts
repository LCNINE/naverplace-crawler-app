import { resolve } from "node:path";

export interface WorkerConfig {
  keyword: string;
  mode: "single" | "all_korea";
  /** 워커별 테이블 지정. 없으면 SUPABASE_TABLE 사용 */
  table?: string;
  city?: string;
  district?: string;
  dong?: string;
  slowMo?: number;
  collectMenu?: boolean;
  extraCategoryKeywords?: string[];
  autoRestart?: boolean;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`필수 환경변수 없음: ${name}`);
  return v;
}

function parseWorkers(): WorkerConfig[] {
  const raw = process.env.WORKERS;
  if (!raw) throw new Error("필수 환경변수 없음: WORKERS");
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("WORKERS는 비어있지 않은 JSON 배열이어야 합니다.");
    }
    return parsed as WorkerConfig[];
  } catch (e) {
    throw new Error(`WORKERS 파싱 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export const config = {
  supabase: {
    url: required("SUPABASE_URL"),
    anonKey: required("SUPABASE_ANON_KEY"),
    table: process.env.SUPABASE_TABLE,
  },
  chatWebhookUrl: process.env.CHAT_WEBHOOK_URL,
  port: parseInt(process.env.PORT ?? "3000", 10),
  dataDir: resolve(process.env.DATA_DIR ?? "./data"),
  workers: parseWorkers(),
};
