import { ipcMain } from "electron";
import { z } from "zod";
import { getProgressRepo } from "../storage/progress.repo.js";
import { makeSessionKey } from "../types.js";
import { recentLogs, clearLogs } from "../logger.js";

const SessionRefSchema = z.object({
  mode: z.enum(["single", "all_korea"]).optional(),
  keyword: z.string(),
  city: z.string(),
  district: z.string(),
  dong: z.string(),
});

export function registerProgressIpc() {
  ipcMain.handle("progress:get", async (_e, raw) => {
    const parsed = SessionRefSchema.parse(raw);
    const key = makeSessionKey(parsed);
    const session = await getProgressRepo().get(key);
    return { session };
  });

  ipcMain.handle("progress:clear", async (_e, raw) => {
    const parsed = SessionRefSchema.parse(raw);
    const key = makeSessionKey(parsed);
    await getProgressRepo().delete(key);
    return { ok: true };
  });

  ipcMain.handle("progress:listAll", async () => {
    return await getProgressRepo().loadAll();
  });

  ipcMain.handle("logs:recent", async () => {
    return recentLogs();
  });

  ipcMain.handle("logs:clear", async () => {
    clearLogs();
    return { ok: true };
  });
}
