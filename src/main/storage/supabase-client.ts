import {
  createClient as createSupabaseClient,
  SupabaseClient,
  SupabaseClientOptions,
} from "@supabase/supabase-js";
import WebSocket from "ws";

/**
 * Electron의 임베디드 Node(현재 v20)에는 native WebSocket이 없어서
 * supabase-js 2.45+의 RealtimeClient가 throw합니다.
 * `ws` 패키지를 transport로 주입해서 회피합니다.
 * 모든 main 프로세스 코드는 이 헬퍼를 거쳐야 합니다.
 */
export function createClient(
  url: string,
  key: string,
  opts?: SupabaseClientOptions<"public">
): SupabaseClient {
  return createSupabaseClient(url, key, {
    ...opts,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      ...opts?.auth,
    },
    realtime: {
      ...opts?.realtime,
      // ws의 default export는 WebSocket 클래스 — supabase realtime이 기대하는 형식
      transport: WebSocket as unknown as never,
    },
  });
}
