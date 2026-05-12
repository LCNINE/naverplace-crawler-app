import { app, safeStorage } from "electron";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import {
  createClient as createSupabaseClient,
  SupabaseClient,
} from "@supabase/supabase-js";
import WebSocket from "ws";
import { AUTH_SUPABASE_URL, AUTH_SUPABASE_ANON_KEY } from "./auth-config.js";

const SESSION_FILE = () => join(app.getPath("userData"), "session.json");

interface StoredSession {
  encrypted: boolean;
  data: string; // JSON-stringified session
}

let cachedClient: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  cachedClient = createSupabaseClient(AUTH_SUPABASE_URL, AUTH_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: { transport: WebSocket as unknown as never },
  });
  return cachedClient;
}

async function writeSession(sessionJson: string): Promise<void> {
  const useEncryption = safeStorage.isEncryptionAvailable();
  const payload: StoredSession = {
    encrypted: useEncryption,
    data: useEncryption
      ? safeStorage.encryptString(sessionJson).toString("base64")
      : sessionJson,
  };
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  const tmp = SESSION_FILE() + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(payload), "utf8");
  await fs.rename(tmp, SESSION_FILE());
}

async function readSession(): Promise<string | null> {
  try {
    const raw = await fs.readFile(SESSION_FILE(), "utf8");
    const parsed = JSON.parse(raw) as StoredSession;
    if (parsed.encrypted && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(parsed.data, "base64"));
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await fs.unlink(SESSION_FILE());
  } catch {
    /* ignore */
  }
}

export interface AuthUser {
  id: string;
  email: string;
}

function mapAuthError(raw: string | undefined): string {
  const msg = (raw ?? "").toLowerCase();
  if (msg.includes("invalid login credentials") || msg.includes("invalid email or password")) {
    return "이메일 또는 비밀번호가 올바르지 않습니다.";
  }
  if (msg.includes("email not confirmed")) {
    return "이메일 인증이 완료되지 않은 계정입니다. 관리자에게 문의해 주세요.";
  }
  if (msg.includes("user not found") || msg.includes("user_not_found")) {
    return "등록되지 않은 이메일입니다.";
  }
  if (msg.includes("too many requests") || msg.includes("rate limit")) {
    return "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (msg.includes("invalid email") || msg.includes("email address") && msg.includes("invalid")) {
    return "올바른 이메일 형식이 아닙니다.";
  }
  if (msg.includes("password should be") || (msg.includes("password") && msg.includes("characters"))) {
    return "비밀번호 형식이 올바르지 않습니다.";
  }
  if (msg.includes("fetch failed") || msg.includes("network") || msg.includes("econnrefused") || msg.includes("enotfound")) {
    return "네트워크 연결에 실패했습니다. 인터넷 연결을 확인해 주세요.";
  }
  // 그 외 — 원문 유지 (디버깅용)
  return raw && raw.length > 0 ? raw : "로그인에 실패했습니다.";
}

export async function signIn(
  email: string,
  password: string
): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }> {
  const client = getClient();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session || !data.user || !data.user.email) {
    return {
      ok: false,
      error: mapAuthError(error?.message),
    };
  }
  await writeSession(JSON.stringify(data.session));
  return { ok: true, user: { id: data.user.id, email: data.user.email } };
}

export async function signOut(): Promise<void> {
  await clearSession();
}

/**
 * 저장된 세션 복원 + refresh 시도.
 * 성공 시 사용자 정보 반환, 실패 시 null.
 */
export async function restoreSession(): Promise<AuthUser | null> {
  const raw = await readSession();
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as {
      refresh_token?: string;
      access_token?: string;
    };
    if (!stored.refresh_token) return null;
    const client = getClient();
    const { data, error } = await client.auth.refreshSession({
      refresh_token: stored.refresh_token,
    });
    if (error || !data.session || !data.user || !data.user.email) {
      await clearSession();
      return null;
    }
    await writeSession(JSON.stringify(data.session));
    return { id: data.user.id, email: data.user.email };
  } catch {
    await clearSession();
    return null;
  }
}
