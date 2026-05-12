import { ipcMain, BrowserWindow, powerSaveBlocker } from "electron";
import { z } from "zod";
import { createClient } from "../storage/supabase-client.js";
import { randomUUID } from "node:crypto";
import { loadFullSecrets } from "../secrets.js";
import { getProgressRepo } from "../storage/progress.repo.js";
import { SupabaseRepo } from "../storage/supabase.repo.js";
import {
  tableExists,
  tryCreateTable,
  getCreateTableSQL,
} from "../storage/schema.js";
import { CrawlSession } from "../crawler/runner.js";
import { createLogger } from "../logger.js";
import {
  makeSessionKey,
  type CrawlStartPayload,
  type SessionState,
} from "../types.js";

const StartSchema = z.object({
  mode: z.enum(["single", "all_korea"]),
  keyword: z.string().min(1),
  city: z.string().optional(),
  district: z.string().optional(),
  dong: z.string().optional(),
  headful: z.boolean(),
  slowMo: z.number().min(0).max(60000),
  resume: z.boolean(),
});

type SessionEntry = {
  id: string;
  session: CrawlSession;
  controller: AbortController;
  blockerId: number;
};

const activeSessions = new Map<string, SessionEntry>();

export function getActiveSessions() {
  return activeSessions;
}

function broadcast(window: BrowserWindow, channel: string, payload: unknown) {
  if (window.isDestroyed()) return;
  window.webContents.send(channel, payload);
}

export function registerCrawlerIpc(mainWindow: BrowserWindow) {
  ipcMain.handle("crawler:preflight", async (_e, raw) => {
    const parsed = z.object({ table: z.string().min(1) }).parse(raw);
    const secrets = await loadFullSecrets();
    if (!secrets) throw new Error("자격증명이 없습니다.");
    const client = createClient(secrets.url, secrets.anonKey);
    try {
      const exists = await tableExists(client, parsed.table);
      return { tableExists: exists };
    } catch (e) {
      return {
        tableExists: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });

  ipcMain.handle("crawler:create-table", async (_e, raw) => {
    const parsed = z
      .object({ table: z.string().min(1), useServiceKey: z.boolean() })
      .parse(raw);
    const secrets = await loadFullSecrets();
    if (!secrets) throw new Error("자격증명이 없습니다.");
    const sql = getCreateTableSQL(parsed.table);
    if (parsed.useServiceKey && secrets.serviceKey) {
      const result = await tryCreateTable(
        secrets.url,
        secrets.serviceKey,
        parsed.table
      );
      if (result.ok) return { ok: true };
      return { ok: false, sql, error: result.error };
    }
    return { ok: false, sql };
  });

  ipcMain.handle("crawler:start", async (_e, raw) => {
    const parsed = StartSchema.parse(raw) as CrawlStartPayload;
    const secrets = await loadFullSecrets();
    if (!secrets) throw new Error("자격증명이 없습니다.");

    if (parsed.mode === "single") {
      if (!parsed.city || !parsed.district || !parsed.dong) {
        throw new Error("단일 모드는 시/구/동을 모두 선택해야 합니다.");
      }
    }

    const sessionId = randomUUID();
    const key = makeSessionKey({
      mode: parsed.mode,
      keyword: parsed.keyword,
      city: parsed.city,
      district: parsed.district,
      dong: parsed.dong,
    });
    const progressRepo = getProgressRepo();
    const prev = await progressRepo.get(key);

    const resumeFrom =
      parsed.resume && prev
        ? {
            cityIndex: prev.cityIndex,
            districtIndex: prev.districtIndex,
            dongIndex: prev.dongIndex,
            page: prev.page,
            listIndex: prev.listIndex,
          }
        : undefined;

    const initState: SessionState = {
      mode: parsed.mode,
      keyword: parsed.keyword,
      city:
        parsed.mode === "single"
          ? parsed.city!
          : prev?.city ?? "",
      district:
        parsed.mode === "single"
          ? parsed.district!
          : prev?.district ?? "",
      dong:
        parsed.mode === "single" ? parsed.dong! : prev?.dong ?? "",
      page: resumeFrom?.page ?? 1,
      listIndex: resumeFrom?.listIndex ?? 0,
      processed: parsed.resume ? prev?.processed ?? 0 : 0,
      cityIndex: resumeFrom?.cityIndex ?? 0,
      districtIndex: resumeFrom?.districtIndex ?? 0,
      dongIndex: resumeFrom?.dongIndex ?? 0,
      status: "running",
      updatedAt: new Date().toISOString(),
    };
    await progressRepo.set(key, initState);

    const controller = new AbortController();
    const logger = createLogger();
    const placesRepo = new SupabaseRepo({
      url: secrets.url,
      key: secrets.anonKey,
      table: secrets.table,
    });

    const blockerId = powerSaveBlocker.start("prevent-display-sleep");

    const baseProcessed = initState.processed;
    const session = new CrawlSession({
      sessionId,
      mode: parsed.mode,
      keyword: parsed.keyword,
      city: parsed.city,
      district: parsed.district,
      dong: parsed.dong,
      headful: parsed.headful,
      slowMo: parsed.slowMo,
      resumeFrom,
      placesRepo,
      logger,
      signal: controller.signal,
      onProgress: async (e) => {
        const total = baseProcessed + e.processed;
        await progressRepo
          .patch(key, {
            city: e.city,
            district: e.district,
            dong: e.dong,
            cityIndex: e.cityIndex,
            districtIndex: e.districtIndex,
            dongIndex: e.dongIndex,
            page: e.page,
            listIndex: e.listIndex,
            processed: total,
            status: "running",
          })
          .catch(() => {});
        broadcast(mainWindow, "crawler:progress", {
          sessionId,
          mode: parsed.mode,
          city: e.city,
          district: e.district,
          dong: e.dong,
          cityIndex: e.cityIndex,
          districtIndex: e.districtIndex,
          dongIndex: e.dongIndex,
          page: e.page,
          listIndex: e.listIndex,
          processed: total,
        });
      },
    });

    activeSessions.set(sessionId, {
      id: sessionId,
      session,
      controller,
      blockerId,
    });

    session
      .start()
      .then(async () => {
        const stoppedByUser = controller.signal.aborted;
        const s = session.getState();
        await progressRepo
          .patch(key, {
            city: s.city,
            district: s.district,
            dong: s.dong,
            cityIndex: s.cityIndex,
            districtIndex: s.districtIndex,
            dongIndex: s.dongIndex,
            page: s.page,
            listIndex: s.listIndex,
            processed: baseProcessed + s.processed,
            status: stoppedByUser ? "stopped" : "completed",
          })
          .catch(() => {});
        broadcast(mainWindow, "crawler:done", { sessionId, ok: true });
      })
      .catch(async (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        await progressRepo
          .patch(key, { status: "error", error: msg })
          .catch(() => {});
        broadcast(mainWindow, "crawler:done", {
          sessionId,
          ok: false,
          error: msg,
        });
      })
      .finally(() => {
        try {
          if (powerSaveBlocker.isStarted(blockerId)) {
            powerSaveBlocker.stop(blockerId);
          }
        } catch {
          /* ignore */
        }
        activeSessions.delete(sessionId);
      });

    return { sessionId };
  });

  ipcMain.handle("crawler:stop", async (_e, raw) => {
    const parsed = z.object({ sessionId: z.string() }).parse(raw);
    const entry = activeSessions.get(parsed.sessionId);
    if (!entry) return { ok: false, error: "세션을 찾을 수 없습니다." };
    entry.controller.abort();
    await entry.session.stop();
    return { ok: true };
  });

  ipcMain.handle("sessions:listActive", async () => {
    return Array.from(activeSessions.values()).map((entry) => ({
      sessionId: entry.id,
      state: entry.session.getState(),
    }));
  });
}

export async function stopAllSessions(): Promise<void> {
  for (const entry of activeSessions.values()) {
    try {
      entry.controller.abort();
      await entry.session.stop();
      await entry.session.dispose();
    } catch {
      /* ignore */
    }
  }
  activeSessions.clear();
}
