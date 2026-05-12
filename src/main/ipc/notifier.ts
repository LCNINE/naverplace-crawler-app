import { ipcMain } from "electron";
import { z } from "zod";
import { sendTestMessage } from "../notifier.js";

const TestSchema = z.object({
  webhookUrl: z
    .string()
    .url()
    .startsWith("https://chat.googleapis.com/"),
});

export function registerNotifierIpc() {
  ipcMain.handle("notifier:test", async (_e, raw) => {
    const parsed = TestSchema.parse(raw);
    const result = await sendTestMessage(parsed.webhookUrl);
    return result;
  });
}
