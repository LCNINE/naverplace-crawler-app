import { join } from "node:path";
import { CrawlSession } from "./crawler/runner.js";
import { SupabaseRepo } from "./storage/supabase.repo.js";
import { getProgressRepo } from "./storage/progress.repo.js";
import { getTaskStore } from "./task-store.js";
import { createWorkerLogger } from "./logger.js";
import { config } from "./config.js";
import type { Task, SlotInfo } from "./types.js";

const MAX_SLOTS = 3;

interface RunningEntry {
  slotId: number;
  taskId: string;
  controller: AbortController;
  session: CrawlSession;
  startedAt: Date;
  prevDongKey: string;
  currentCity: string;
  currentDistrict: string;
  currentDong: string;
  currentPage: number;
}

export class QueueManager {
  private slots = new Map<number, RunningEntry>();

  async startQueue(): Promise<void> {
    const store = getTaskStore();
    await store.setRunning(true);
    this.fillSlots();
  }

  async stopQueue(): Promise<void> {
    const store = getTaskStore();
    await store.setRunning(false);
    for (const entry of this.slots.values()) {
      entry.controller.abort();
      await entry.session.stop().catch(() => {});
      await store.updateTaskStatus(entry.taskId, "idle", {
        workerSlotId: undefined,
        startedAt: undefined,
      });
    }
    this.slots.clear();
  }

  async stopSlot(slotId: number): Promise<boolean> {
    const entry = this.slots.get(slotId);
    if (!entry) return false;
    const store = getTaskStore();
    entry.controller.abort();
    await entry.session.stop().catch(() => {});
    this.slots.delete(slotId);
    await store.updateTaskStatus(entry.taskId, "idle", {
      workerSlotId: undefined,
      startedAt: undefined,
    });
    if (await store.isRunning()) {
      this.fillSlots();
    }
    return true;
  }

  getStatus(): { running: boolean; slots: SlotInfo[] } {
    const slots: SlotInfo[] = Array.from({ length: MAX_SLOTS }, (_, i) => {
      const entry = this.slots.get(i);
      if (!entry) return { slotId: i, taskId: null, keyword: null, status: "idle" as const };
      return {
        slotId: i,
        taskId: entry.taskId,
        keyword: null,
        status: "running" as const,
        currentCity: entry.currentCity,
        currentDistrict: entry.currentDistrict,
        currentDong: entry.currentDong,
        currentPage: entry.currentPage,
        startedAt: entry.startedAt.toISOString(),
      };
    });
    return { running: false, slots };
  }

  async getFullStatus(): Promise<{ running: boolean; slots: SlotInfo[]; tasks: Task[] }> {
    const store = getTaskStore();
    const state = await store.getState();
    const slotBase = this.getStatus();

    // 슬롯에 keyword 채우기
    const slots = slotBase.slots.map((slot) => {
      if (!slot.taskId) return slot;
      const task = state.tasks.find((t) => t.id === slot.taskId);
      return { ...slot, keyword: task?.keyword ?? null, dongsCompleted: task?.dongsCompleted };
    });

    return { running: state.running, slots, tasks: state.tasks };
  }

  private fillSlots(): void {
    // 비동기지만 fire-and-forget — 내부에서 await 사용
    this.doFillSlots().catch((e) => console.error("fillSlots 오류:", e));
  }

  private async doFillSlots(): Promise<void> {
    const store = getTaskStore();
    if (!(await store.isRunning())) return;

    const tasks = await store.getTasks();
    const idleTasks = tasks.filter((t) => t.status === "idle");

    for (let slotId = 0; slotId < MAX_SLOTS; slotId++) {
      if (this.slots.has(slotId)) continue;
      const nextTask = idleTasks.shift();
      if (!nextTask) break;
      await this.assignTaskToSlot(nextTask, slotId);
    }
  }

  private async assignTaskToSlot(task: Task, slotId: number): Promise<void> {
    const store = getTaskStore();
    const progressRepo = getProgressRepo();
    const logger = createWorkerLogger(`slot${slotId}_${task.keyword}`);

    const table = task.table ?? config.supabase.table;
    if (!table) {
      logger.error(`슬롯[${slotId}]: table 미설정`);
      return;
    }

    const placesRepo = new SupabaseRepo({
      url: config.supabase.url,
      key: config.supabase.anonKey,
      table,
    });

    const userDataDir = join(config.dataDir, `playwright-profile-${task.id.slice(0, 8)}`);
    const sessionKey = `${task.keyword}|ALL_KOREA`;
    const prev = await progressRepo.get(sessionKey);
    const resumeFrom = prev
      ? {
          cityIndex: prev.cityIndex,
          districtIndex: prev.districtIndex,
          dongIndex: prev.dongIndex,
          page: prev.page,
          listIndex: prev.listIndex,
        }
      : undefined;

    const controller = new AbortController();
    const session = new CrawlSession({
      sessionId: task.id,
      mode: "all_korea",
      keyword: task.keyword,
      headful: false,
      slowMo: task.slowMo ?? 0,
      collectMenu: task.collectMenu ?? false,
      extraCategoryKeywords: task.extraCategoryKeywords,
      resumeFrom,
      autoRestart: false,
      userDataDir,
      placesRepo,
      logger,
      signal: controller.signal,
      onProgress: async (e) => {
        const entry = this.slots.get(slotId);
        if (!entry) return;

        const dongKey = `${e.cityIndex}|${e.districtIndex}|${e.dongIndex}`;
        if (dongKey !== entry.prevDongKey && entry.prevDongKey !== "") {
          const current = (await store.getTasks()).find((t) => t.id === task.id);
          await store.updateTask(task.id, {
            dongsCompleted: (current?.dongsCompleted ?? 0) + 1,
          });
        }
        entry.prevDongKey = dongKey;
        entry.currentCity = e.city ?? "";
        entry.currentDistrict = e.district ?? "";
        entry.currentDong = e.dong ?? "";
        entry.currentPage = e.page ?? 1;

        const total = (prev?.processed ?? 0) + e.processed;
        await progressRepo
          .patch(sessionKey, {
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
      },
    });

    const entry: RunningEntry = {
      slotId,
      taskId: task.id,
      controller,
      session,
      startedAt: new Date(),
      prevDongKey: "",
      currentCity: "",
      currentDistrict: "",
      currentDong: "",
      currentPage: 1,
    };
    this.slots.set(slotId, entry);

    await store.updateTaskStatus(task.id, "running", {
      workerSlotId: slotId,
      startedAt: new Date().toISOString(),
      lastError: undefined,
    });

    logger.info(`🚀 슬롯[${slotId}] 작업 시작: [${task.keyword}] resume=${!!resumeFrom}`);

    session
      .start()
      .then(async () => {
        const stoppedByUser = controller.signal.aborted;
        if (!stoppedByUser) {
          logger.info(`✅ 슬롯[${slotId}] 작업 완료: [${task.keyword}]`);
          this.slots.delete(slotId);
          await this.onTaskCompleted(task.id);
        }
      })
      .catch(async (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`❌ 슬롯[${slotId}] 작업 오류: [${task.keyword}] ${msg}`);
        this.slots.delete(slotId);
        if (!controller.signal.aborted) {
          await this.onTaskError(task.id, msg);
        }
      });
  }

  private async onTaskCompleted(taskId: string): Promise<void> {
    const store = getTaskStore();
    await store.updateTaskStatus(taskId, "completed", {
      workerSlotId: undefined,
    });

    const tasks = await store.getTasks();
    const allDone = tasks.every((t) => t.status === "completed");
    if (allDone) {
      console.log("🔄 전체 사이클 완료 — 초기화 후 재시작");
      await store.resetCycle();
    }
    this.fillSlots();
  }

  private async onTaskError(taskId: string, errorMsg: string): Promise<void> {
    const store = getTaskStore();
    await store.updateTaskStatus(taskId, "error", {
      lastError: errorMsg,
      workerSlotId: undefined,
    });

    setTimeout(async () => {
      const tasks = await store.getTasks();
      const task = tasks.find((t) => t.id === taskId);
      if (task && task.status === "error" && (await store.isRunning())) {
        await store.updateTaskStatus(taskId, "idle");
        this.fillSlots();
      }
    }, 30_000);
  }

  async stopAll(): Promise<void> {
    await this.stopQueue();
  }
}
