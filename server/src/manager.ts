import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { hostname } from "node:os";
import { CrawlSession } from "./crawler/runner.js";
import { SupabaseRawRepo } from "./storage/supabase.raw-repo.js";
import { RunRecorder, FileDumpSink } from "./crawler/logging/run-recorder.js";
import { getProgressRepo } from "./storage/progress.repo.js";
import { createWorkerLogger } from "./logger.js";
import { config, type WorkerConfig } from "./config.js";

/** cfg.table('coin_laundry_v2') → canonical category('coin_laundry'). */
function resolveCategory(cfg: WorkerConfig): string {
  if (cfg.table) return cfg.table.replace(/_v\d+$/i, "");
  return cfg.keyword;
}

interface WorkerEntry {
  id: string;
  config: WorkerConfig;
  session: CrawlSession;
  controller: AbortController;
  startedAt: Date;
  sessionId: string;
}

export class WorkerManager {
  private workers = new Map<string, WorkerEntry>();

  async startAll(): Promise<void> {
    for (const cfg of config.workers) {
      await this.startWorker(cfg);
    }
  }

  private async startWorker(cfg: WorkerConfig): Promise<void> {
    const workerId = `${cfg.keyword}_${cfg.mode}`;
    if (this.workers.has(workerId)) {
      console.warn(`워커 이미 실행 중: ${workerId}`);
      return;
    }

    const sessionId = randomUUID();
    const controller = new AbortController();
    const logger = createWorkerLogger(workerId);
    const progressRepo = getProgressRepo();

    const category = resolveCategory(cfg);
    const rawRepo = new SupabaseRawRepo({
      url: config.supabase.url,
      key: config.supabase.anonKey,
    });
    const recorder = new RunRecorder({
      runId: "pending",
      base: logger,
      dumpSink: new FileDumpSink(config.dataDir),
    });

    // persistent context 프로파일을 워커별로 분리
    const userDataDir = join(config.dataDir, `playwright-profile-${workerId.replace(/[^a-zA-Z0-9_-]/g, "_")}`);

    const sessionKey = cfg.mode === "all_korea"
      ? `${cfg.keyword}|ALL_KOREA`
      : `${cfg.keyword}|${cfg.city ?? ""}|${cfg.district ?? ""}|${cfg.dong ?? ""}`;

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

    const session = new CrawlSession({
      sessionId,
      mode: cfg.mode,
      keyword: cfg.keyword,
      city: cfg.city,
      district: cfg.district,
      dong: cfg.dong,
      headful: false,
      slowMo: cfg.slowMo ?? 0,
      collectMenu: cfg.collectMenu ?? false,
      extraCategoryKeywords: cfg.extraCategoryKeywords,
      resumeFrom,
      autoRestart: cfg.mode === "all_korea" ? (cfg.autoRestart ?? true) : false,
      userDataDir,
      rawRepo,
      category,
      host: hostname(),
      recorder,
      logger: recorder.asLogger(),
      signal: controller.signal,
      onProgress: async (e) => {
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

    const entry: WorkerEntry = {
      id: workerId,
      config: cfg,
      session,
      controller,
      startedAt: new Date(),
      sessionId,
    };
    this.workers.set(workerId, entry);

    logger.info(`🚀 워커 시작: [${workerId}] sessionId=${sessionId}, resume=${!!resumeFrom}`);

    session
      .start()
      .then(async () => {
        const stoppedByUser = controller.signal.aborted;
        const s = session.getState();
        await progressRepo
          .patch(sessionKey, {
            city: s.city,
            district: s.district,
            dong: s.dong,
            cityIndex: s.cityIndex,
            districtIndex: s.districtIndex,
            dongIndex: s.dongIndex,
            page: s.page,
            listIndex: s.listIndex,
            processed: (prev?.processed ?? 0) + s.processed,
            status: stoppedByUser ? "stopped" : "completed",
          })
          .catch(() => {});
        logger.info(`✅ 워커 완료: [${workerId}] stoppedByUser=${stoppedByUser}`);
      })
      .catch(async (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        await progressRepo.patch(sessionKey, { status: "error", error: msg }).catch(() => {});
        logger.error(`❌ 워커 오류: [${workerId}] ${msg}`);

        // 비정상 종료 시 30초 후 자동 재시작
        if (!controller.signal.aborted) {
          logger.info(`🔄 30초 후 워커 재시작: [${workerId}]`);
          setTimeout(() => {
            if (!controller.signal.aborted) {
              this.workers.delete(workerId);
              this.startWorker(cfg).catch((e) =>
                console.error(`재시작 실패: ${workerId}`, e)
              );
            }
          }, 30_000);
        }
      })
      .finally(() => {
        this.workers.delete(workerId);
      });
  }

  getStatus() {
    return Array.from(this.workers.values()).map((entry) => ({
      id: entry.id,
      sessionId: entry.sessionId,
      keyword: entry.config.keyword,
      mode: entry.config.mode,
      startedAt: entry.startedAt.toISOString(),
      state: entry.session.getState(),
    }));
  }

  async stopWorker(workerId: string): Promise<boolean> {
    const entry = this.workers.get(workerId);
    if (!entry) return false;
    entry.controller.abort();
    await entry.session.stop();
    return true;
  }

  async stopAll(): Promise<void> {
    for (const entry of this.workers.values()) {
      entry.controller.abort();
      await entry.session.stop().catch(() => {});
    }
  }
}
