import { app } from "electron";
import { promises as fs, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SessionState } from "../types.js";

interface ProgressFile {
  version: 1;
  sessions: Record<string, SessionState>;
}

const FILE = () => join(app.getPath("userData"), "progress.json");

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
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    const tmp = FILE() + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(this.cache, null, 2), "utf8");
    await fs.rename(tmp, FILE());
  }

  flushSync(): void {
    if (!this.cache) return;
    try {
      mkdirSync(app.getPath("userData"), { recursive: true });
      const tmp = FILE() + ".tmp";
      writeFileSync(tmp, JSON.stringify(this.cache, null, 2), "utf8");
      renameSync(tmp, FILE());
    } catch {
      /* swallow */
    }
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
    if (!prev) {
      throw new Error(`No session for key: ${key}`);
    }
    file.sessions[key] = {
      ...prev,
      ...partial,
      updatedAt: new Date().toISOString(),
    };
    await this.persist();
  }

  async delete(key: string): Promise<void> {
    const file = await this.load();
    if (file.sessions[key]) {
      delete file.sessions[key];
      await this.persist();
    }
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
