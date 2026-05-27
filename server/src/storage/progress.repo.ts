import { promises as fs, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";

export interface SessionState {
  mode: "single" | "all_korea";
  keyword: string;
  city: string;
  district: string;
  dong: string;
  page: number;
  listIndex: number;
  processed: number;
  cityIndex?: number;
  districtIndex?: number;
  dongIndex?: number;
  status: "running" | "stopped" | "completed" | "error";
  updatedAt: string;
  error?: string;
}

interface ProgressFile {
  version: 1;
  sessions: Record<string, SessionState>;
}

const FILE = () => join(config.dataDir, "progress.json");

const emptyFile = (): ProgressFile => ({ version: 1, sessions: {} });

export class ProgressRepo {
  private cache: ProgressFile | null = null;

  private async load(): Promise<ProgressFile> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(FILE(), "utf8");
      const parsed = JSON.parse(raw) as ProgressFile;
      this.cache = parsed.version === 1 && parsed.sessions ? parsed : emptyFile();
    } catch {
      this.cache = emptyFile();
    }
    return this.cache;
  }

  private async persist(): Promise<void> {
    if (!this.cache) return;
    await fs.mkdir(config.dataDir, { recursive: true });
    const tmp = FILE() + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(this.cache, null, 2), "utf8");
    await fs.rename(tmp, FILE());
  }

  flushSync(): void {
    if (!this.cache) return;
    try {
      mkdirSync(config.dataDir, { recursive: true });
      const tmp = FILE() + ".tmp";
      writeFileSync(tmp, JSON.stringify(this.cache, null, 2), "utf8");
      renameSync(tmp, FILE());
    } catch { /* swallow */ }
  }

  async get(key: string): Promise<SessionState | undefined> {
    const file = await this.load();
    return file.sessions[key];
  }

  async set(key: string, state: SessionState): Promise<void> {
    const file = await this.load();
    file.sessions[key] = state;
    await this.persist();
  }

  async patch(key: string, partial: Partial<SessionState>): Promise<void> {
    const file = await this.load();
    const prev = file.sessions[key];
    if (!prev) return;
    file.sessions[key] = { ...prev, ...partial, updatedAt: new Date().toISOString() };
    await this.persist();
  }

  async loadAll(): Promise<Record<string, SessionState>> {
    const file = await this.load();
    return { ...file.sessions };
  }
}

let singleton: ProgressRepo | null = null;
export function getProgressRepo(): ProgressRepo {
  if (!singleton) singleton = new ProgressRepo();
  return singleton;
}
