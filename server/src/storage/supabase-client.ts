import {
  createClient as createSupabaseClient,
  SupabaseClient,
  SupabaseClientOptions,
} from "@supabase/supabase-js";
import WebSocket from "ws";

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
      transport: WebSocket as unknown as never,
    },
  });
}
