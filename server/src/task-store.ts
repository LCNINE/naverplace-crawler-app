import { promises as fs } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import type { Task, TaskStatus, QueueState } from "./types.js";

const FILE = () => join(config.dataDir, "queue.json");

const emptyState = (): QueueState => ({
  version: 2,
  running: false,
  tasks: [],
});

export class TaskStore {
  private cache: QueueState | null = null;
  private pendingWrite: Promise<void> = Promise.resolve();

  private async load(): Promise<QueueState> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(FILE(), "utf8");
      const parsed = JSON.parse(raw) as QueueState;
      this.cache = parsed.version === 2 && Array.isArray(parsed.tasks) ? parsed : emptyState();
    } catch {
      this.cache = emptyState();
    }
    return this.cache;
  }

  private persist(): void {
    this.pendingWrite = this.pendingWrite.then(async () => {
      if (!this.cache) return;
      await fs.mkdir(config.dataDir, { recursive: true });
      const tmp = FILE() + ".tmp";
      await fs.writeFile(tmp, JSON.stringify(this.cache, null, 2), "utf8");
      await fs.rename(tmp, FILE());
    }).catch(() => {});
  }

  async getTasks(): Promise<Task[]> {
    const state = await this.load();
    return [...state.tasks].sort((a, b) => a.order - b.order);
  }

  async getState(): Promise<QueueState> {
    const state = await this.load();
    return {
      ...state,
      tasks: [...state.tasks].sort((a, b) => a.order - b.order),
    };
  }

  async isRunning(): Promise<boolean> {
    const state = await this.load();
    return state.running;
  }

  async setRunning(running: boolean): Promise<void> {
    const state = await this.load();
    state.running = running;
    this.persist();
  }

  async addTask(input: {
    keyword: string;
    table: string;
    slowMo: number;
    collectMenu: boolean;
    extraCategoryKeywords: string[];
  }): Promise<Task> {
    const state = await this.load();
    const maxOrder = state.tasks.reduce((m, t) => Math.max(m, t.order), -1);
    const task: Task = {
      id: randomUUID(),
      keyword: input.keyword,
      table: input.table,
      slowMo: input.slowMo,
      collectMenu: input.collectMenu,
      extraCategoryKeywords: input.extraCategoryKeywords,
      order: maxOrder + 1,
      status: "idle",
      dongsCompleted: 0,
      updatedAt: new Date().toISOString(),
    };
    state.tasks.push(task);
    this.persist();
    return task;
  }

  async updateTask(id: string, partial: Partial<Omit<Task, "id">>): Promise<Task | null> {
    const state = await this.load();
    const idx = state.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    state.tasks[idx] = {
      ...state.tasks[idx],
      ...partial,
      id,
      updatedAt: new Date().toISOString(),
    };
    this.persist();
    return state.tasks[idx];
  }

  async deleteTask(id: string): Promise<boolean> {
    const state = await this.load();
    const before = state.tasks.length;
    state.tasks = state.tasks.filter((t) => t.id !== id);
    if (state.tasks.length === before) return false;
    this.persist();
    return true;
  }

  async reorder(ids: string[]): Promise<void> {
    const state = await this.load();
    ids.forEach((id, idx) => {
      const task = state.tasks.find((t) => t.id === id);
      if (task) task.order = idx;
    });
    this.persist();
  }

  async updateTaskStatus(id: string, status: TaskStatus, extra?: Partial<Task>): Promise<void> {
    await this.updateTask(id, { status, ...extra });
  }

  async resetCycle(): Promise<void> {
    const state = await this.load();
    for (const task of state.tasks) {
      task.status = "idle";
      task.dongsCompleted = 0;
      task.workerSlotId = undefined;
      task.startedAt = undefined;
      task.lastError = undefined;
      task.updatedAt = new Date().toISOString();
    }
    this.persist();
  }
}

let singleton: TaskStore | null = null;
export function getTaskStore(): TaskStore {
  if (!singleton) singleton = new TaskStore();
  return singleton;
}
