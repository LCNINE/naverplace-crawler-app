import { ipcMain } from "electron";
import { z } from "zod";
import { signIn, signOut, restoreSession } from "../auth.js";
import { getDefaultSettingsForEmail } from "../auth-config.js";

const SignInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function registerAuthIpc() {
  ipcMain.handle("auth:signIn", async (_e, raw) => {
    const parsed = SignInSchema.parse(raw);
    return await signIn(parsed.email, parsed.password);
  });

  ipcMain.handle("auth:signOut", async () => {
    await signOut();
    return { ok: true };
  });

  ipcMain.handle("auth:restore", async () => {
    const user = await restoreSession();
    return { user };
  });

  ipcMain.handle("auth:defaultSettings", async (_e, raw) => {
    const parsed = z.object({ email: z.string().email() }).parse(raw);
    const defaults = getDefaultSettingsForEmail(parsed.email);
    return { defaults: defaults ?? null };
  });
}
