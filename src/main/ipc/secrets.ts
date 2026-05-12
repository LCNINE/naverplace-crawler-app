import { ipcMain } from "electron";
import { z } from "zod";
import { createClient } from "../storage/supabase-client.js";
import {
  saveSecrets,
  loadSecrets,
  loadFullSecrets,
  clearSecrets,
} from "../secrets.js";
import type { Secrets } from "../types.js";

const SecretsSchema = z.object({
  url: z.string().url(),
  anonKey: z.string().min(10),
  serviceKey: z.string().optional().or(z.literal("")),
  table: z.string().min(1),
  // Google Chat webhook URL — 비어있어도 됨
  chatWebhookUrl: z
    .string()
    .url()
    .startsWith("https://chat.googleapis.com/")
    .optional()
    .or(z.literal("")),
});

export function registerSecretsIpc() {
  ipcMain.handle("secrets:save", async (_e, raw) => {
    const parsed = SecretsSchema.parse(raw);
    const toSave: Secrets = {
      url: parsed.url,
      anonKey: parsed.anonKey,
      serviceKey: parsed.serviceKey || undefined,
      table: parsed.table,
      chatWebhookUrl: parsed.chatWebhookUrl || undefined,
    };
    await saveSecrets(toSave);
    return { ok: true };
  });

  ipcMain.handle("secrets:load", async () => {
    return await loadSecrets();
  });

  ipcMain.handle("secrets:clear", async () => {
    await clearSecrets();
    return { ok: true };
  });

  ipcMain.handle("crawler:test-connection", async () => {
    const secrets = await loadFullSecrets();
    if (!secrets) return { ok: false, error: "자격증명이 저장되지 않았습니다." };

    const TIMEOUT_MS = 8000;
    const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
      new Promise((resolve, reject) => {
        const t = setTimeout(
          () => reject(new Error(`타임아웃 (${ms}ms 초과)`)),
          ms
        );
        promise.then(
          (v) => {
            clearTimeout(t);
            resolve(v);
          },
          (e) => {
            clearTimeout(t);
            reject(e);
          }
        );
      });

    try {
      const client = createClient(secrets.url, secrets.anonKey);
      // count:'exact'는 server-side COUNT(*)라 큰 테이블에서 매우 느림.
      // 테이블 존재 + 권한 확인만 필요하므로 limit(1)이면 충분.
      const probe = async () =>
        await client.from(secrets.table).select("*").limit(1);
      const { error } = await withTimeout(probe(), TIMEOUT_MS);
      if (error) {
        return {
          ok: false,
          error: error.message,
          code: (error as { code?: string }).code,
        };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
