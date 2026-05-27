import express from "express";
import { mkdirSync } from "node:fs";
import { config } from "./config.js";
import { WorkerManager } from "./manager.js";

const app = express();
app.use(express.json());

const manager = new WorkerManager();

// 헬스체크
app.get("/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// 전체 워커 상태 조회
app.get("/status", (_req, res) => {
  res.json({ workers: manager.getStatus() });
});

// 전체 워커 중지
app.post("/stop-all", async (_req, res) => {
  await manager.stopAll();
  res.json({ ok: true });
});

// 특정 워커 중지
app.post("/workers/:id/stop", async (req, res) => {
  const ok = await manager.stopWorker(req.params.id);
  if (!ok) {
    res.status(404).json({ ok: false, error: "워커를 찾을 수 없습니다." });
    return;
  }
  res.json({ ok: true });
});

// 정상 종료 핸들러
async function shutdown() {
  console.log("\n🛑 서버 종료 중... 모든 크롤러 정지");
  await manager.stopAll();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// 시작
mkdirSync(config.dataDir, { recursive: true });

const { port, workers } = config;
app.listen(port, () => {
  console.log(`\n🚀 크롤러 서버 시작 (port: ${port})`);
  console.log(`📋 워커 ${workers.length}개 설정:`);
  for (const w of workers) {
    console.log(`   - [${w.keyword}] mode=${w.mode} autoRestart=${w.autoRestart ?? true}`);
  }
  console.log();
});

manager.startAll().catch((err) => {
  console.error("워커 시작 실패:", err);
  process.exit(1);
});
