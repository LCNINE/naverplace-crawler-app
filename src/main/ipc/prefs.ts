import { ipcMain } from "electron";
import { z } from "zod";
import { getPrefs, setLastForm } from "../storage/prefs.repo.js";

const LastFormSchema = z
  .object({
    mode: z.enum(["single", "all_korea"]).optional(),
    keyword: z.string().optional(),
    city: z.string().optional(),
    district: z.string().optional(),
    dong: z.string().optional(),
    headful: z.boolean().optional(),
    slowMo: z.number().optional(),
    collectMenu: z.boolean().optional(),
    extraCategoryKeywords: z.array(z.string()).optional(),
  })
  .strict();

export function registerPrefsIpc() {
  ipcMain.handle("prefs:get", async () => {
    return await getPrefs();
  });

  ipcMain.handle("prefs:setLastForm", async (_e, raw) => {
    const parsed = LastFormSchema.parse(raw);
    await setLastForm(parsed);
    return { ok: true };
  });
}
