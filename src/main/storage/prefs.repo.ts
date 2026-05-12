import { app } from "electron";
import { promises as fs } from "node:fs";
import { join } from "node:path";

export interface AppPrefs {
  lastForm?: {
    mode?: "single" | "all_korea";
    keyword?: string;
    city?: string;
    district?: string;
    dong?: string;
    headful?: boolean;
    slowMo?: number;
  };
}

const FILE = () => join(app.getPath("userData"), "prefs.json");

let cache: AppPrefs | null = null;

async function load(): Promise<AppPrefs> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(FILE(), "utf8");
    const parsed = JSON.parse(raw) as AppPrefs;
    cache = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    cache = {};
  }
  return cache;
}

async function persist(): Promise<void> {
  if (!cache) return;
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  const tmp = FILE() + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2), "utf8");
  await fs.rename(tmp, FILE());
}

export async function getPrefs(): Promise<AppPrefs> {
  return await load();
}

export async function patchPrefs(partial: Partial<AppPrefs>): Promise<void> {
  const cur = await load();
  cache = { ...cur, ...partial };
  await persist();
}

export async function setLastForm(form: AppPrefs["lastForm"]): Promise<void> {
  await patchPrefs({ lastForm: form });
}
