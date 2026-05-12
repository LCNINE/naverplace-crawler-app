import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "./supabase-client.js";

export function getCreateTableSQL(table: string): string {
  // 안전한 식별자만 허용
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(table)) {
    throw new Error(`잘못된 테이블명: ${table}`);
  }
  return `CREATE TABLE IF NOT EXISTS public.${table} (
  id bigserial PRIMARY KEY,
  shop_name text,
  place_id text UNIQUE,
  phone text,
  address text,
  business_hours text,
  links text,
  district text,
  dong text,
  city text,
  image text,
  category_main text,
  category_sub text,
  main_menu text,
  tags text,
  naver_place_url text,
  naver_search text,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
CREATE POLICY "${table}_anon_all" ON public.${table}
  FOR ALL TO anon USING (true) WITH CHECK (true);`;
}

export async function tableExists(
  client: SupabaseClient,
  table: string
): Promise<boolean> {
  const { error } = await client.from(table).select("*").limit(1);
  if (!error) return true;
  // PostgREST: PGRST205 → table not in schema cache (테이블 자체가 없음)
  // PG: 42P01 → undefined_table
  const code = (error as { code?: string }).code;
  const message = error.message ?? "";
  if (
    code === "42P01" ||
    code === "PGRST205" ||
    /relation .* does not exist/i.test(message) ||
    /Could not find the table/i.test(message)
  ) {
    return false;
  }
  // 다른 에러(권한 등)는 throw — 사용자에게 알려야 함
  throw new Error(`테이블 조회 실패: ${error.message}`);
}

/**
 * Service Role Key로 테이블 생성을 시도합니다.
 * 기본적으로 Supabase REST API에는 직접 SQL을 실행하는 endpoint가 없으므로,
 * 프로젝트에 미리 정의된 `exec_sql(sql text)` RPC가 있어야 동작합니다.
 * 없을 경우 false를 반환하므로 호출자는 SQL 스니펫을 사용자에게 보여줘야 합니다.
 */
export async function tryCreateTable(
  serviceRoleUrl: string,
  serviceRoleKey: string,
  table: string
): Promise<{ ok: boolean; error?: string }> {
  const sql = getCreateTableSQL(table);
  const client = createClient(serviceRoleUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await (client.rpc as unknown as (fn: string, args: object) => Promise<{ error: { message: string } | null }>)("exec_sql", { sql });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
