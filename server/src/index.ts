import express from "express";
import cors from "cors";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "./storage/supabase-client.js";
import { config } from "./config.js";
import { QueueManager } from "./queue-manager.js";
import { getTaskStore } from "./task-store.js";
import { getProgressRepo } from "./storage/progress.repo.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

const manager = new QueueManager();
const store = getTaskStore();

// ─── 인증 ──────────────────────────────────────────────────

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: "이메일과 비밀번호를 입력하세요." });
    return;
  }
  const client = createClient(config.supabase.url, config.supabase.anonKey);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    res.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." });
    return;
  }
  if (data.user?.user_metadata?.role !== "admin") {
    res.status(403).json({ error: "접근 권한이 없습니다." });
    return;
  }
  res.json({ access_token: data.session.access_token, expires_at: data.session.expires_at });
});

const requireAdmin: express.RequestHandler = async (req, res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "인증이 필요합니다." });
    return;
  }
  const client = createClient(config.supabase.url, config.supabase.anonKey);
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ error: "유효하지 않은 토큰입니다." });
    return;
  }
  if (user.user_metadata?.role !== "admin") {
    res.status(403).json({ error: "접근 권한이 없습니다." });
    return;
  }
  next();
};

app.use("/api", requireAdmin);

// ─── 헬스체크 ──────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ─── 레거시 상태 조회 (하위 호환) ───────────────────────────
app.get("/status", async (_req, res) => {
  const full = await manager.getFullStatus();
  res.json(full);
});

// ─── 레거시 전체 정지 ───────────────────────────────────────
app.post("/stop-all", async (_req, res) => {
  await manager.stopAll();
  res.json({ ok: true });
});

// ─── 작업 API ──────────────────────────────────────────────

app.get("/api/tasks", async (_req, res) => {
  const tasks = await store.getTasks();
  res.json({ tasks });
});

app.post("/api/tasks", async (req, res) => {
  const { keyword, table, slowMo, collectMenu, extraCategoryKeywords } = req.body ?? {};
  if (!keyword || !table) {
    res.status(400).json({ error: "keyword와 table은 필수입니다." });
    return;
  }
  const task = await store.addTask({
    keyword: String(keyword),
    table: String(table),
    slowMo: Number(slowMo ?? 0),
    collectMenu: Boolean(collectMenu),
    extraCategoryKeywords: Array.isArray(extraCategoryKeywords)
      ? extraCategoryKeywords.map(String)
      : typeof extraCategoryKeywords === "string"
      ? extraCategoryKeywords.split(",").map((s: string) => s.trim()).filter(Boolean)
      : [],
  });
  res.status(201).json(task);
});

app.put("/api/tasks/:id", async (req, res) => {
  const task = await store.getTasks();
  const existing = task.find((t) => t.id === req.params.id);
  if (!existing) {
    res.status(404).json({ error: "작업을 찾을 수 없습니다." });
    return;
  }
  if (existing.status === "running") {
    res.status(409).json({ error: "실행 중인 작업은 수정할 수 없습니다." });
    return;
  }
  const { keyword, table, slowMo, collectMenu, extraCategoryKeywords } = req.body ?? {};
  const updated = await store.updateTask(req.params.id, {
    ...(keyword !== undefined && { keyword: String(keyword) }),
    ...(table !== undefined && { table: String(table) }),
    ...(slowMo !== undefined && { slowMo: Number(slowMo) }),
    ...(collectMenu !== undefined && { collectMenu: Boolean(collectMenu) }),
    ...(extraCategoryKeywords !== undefined && {
      extraCategoryKeywords: Array.isArray(extraCategoryKeywords)
        ? extraCategoryKeywords.map(String)
        : String(extraCategoryKeywords).split(",").map((s: string) => s.trim()).filter(Boolean),
    }),
  });
  res.json(updated);
});

app.delete("/api/tasks/:id", async (req, res) => {
  const tasks = await store.getTasks();
  const existing = tasks.find((t) => t.id === req.params.id);
  if (!existing) {
    res.status(404).json({ error: "작업을 찾을 수 없습니다." });
    return;
  }
  if (existing.status === "running") {
    res.status(409).json({ error: "실행 중인 작업은 삭제할 수 없습니다." });
    return;
  }
  const ok = await store.deleteTask(req.params.id);
  res.json({ ok });
});

app.post("/api/tasks/:id/reset-progress", async (req, res) => {
  const tasks = await store.getTasks();
  const existing = tasks.find((t) => t.id === req.params.id);
  if (!existing) {
    res.status(404).json({ error: "작업을 찾을 수 없습니다." });
    return;
  }
  if (existing.status === "running") {
    res.status(409).json({ error: "실행 중인 작업은 진행 상황을 초기화할 수 없습니다." });
    return;
  }
  const progressRepo = getProgressRepo();
  await progressRepo.delete(`${existing.keyword}|ALL_KOREA`);
  await store.updateTaskStatus(existing.id, "idle", { lastError: undefined });
  await store.updateTask(existing.id, { dongsCompleted: 0 });
  res.json({ ok: true });
});

app.post("/api/tasks/reorder", async (req, res) => {
  const { ids } = req.body ?? {};
  if (!Array.isArray(ids)) {
    res.status(400).json({ error: "ids 배열이 필요합니다." });
    return;
  }
  await store.reorder(ids.map(String));
  res.json({ ok: true });
});

// ─── 큐 제어 API ───────────────────────────────────────────

app.get("/api/queue/state", async (_req, res) => {
  const full = await manager.getFullStatus();
  res.json(full);
});

app.post("/api/queue/start", async (_req, res) => {
  await manager.startQueue();
  res.json({ ok: true });
});

app.post("/api/queue/stop", async (_req, res) => {
  await manager.stopQueue();
  res.json({ ok: true });
});

app.post("/api/workers/:slotId/stop", async (req, res) => {
  const slotId = parseInt(req.params.slotId, 10);
  if (isNaN(slotId) || slotId < 0 || slotId >= 3) {
    res.status(400).json({ error: "슬롯 번호는 0-2 사이여야 합니다." });
    return;
  }
  const ok = await manager.stopSlot(slotId);
  if (!ok) {
    res.status(404).json({ ok: false, error: "해당 슬롯이 실행 중이지 않습니다." });
    return;
  }
  res.json({ ok: true });
});

// ─── 추출/관측용 클라이언트 (v3: raw_places 기반) ───────────
// canonical 상시 테이블이 없으므로 분석 조회 UI(/api/analysis/*, /api/tables)는 제거됨.
// 중복제거·정규화된 추출물은 Supabase 의 extract_latest_places() SQL 함수로 뽑는다.
//   SELECT * FROM extract_latest_places('coin_laundry');
async function getAnalysisClient() {
  return createClient(config.supabase.url, config.supabase.anonKey);
}

// ─── run 관측 API (운영 가시성: 어느 동이 blocked/assert_failed 인지) ──────
app.get("/api/runs", async (req, res) => {
  const client = await getAnalysisClient();
  let query = client
    .from("crawl_runs")
    .select(
      "id, category, keyword, host, slot_id, city, district, dong, status, started_at, finished_at, collected_count, saved_count, error, dump_location"
    )
    .order("started_at", { ascending: false })
    .limit(200);

  if (req.query.category) query = query.eq("category", String(req.query.category));
  if (req.query.status) query = query.eq("status", String(req.query.status));
  if (req.query.session_id) query = query.eq("session_id", String(req.query.session_id));

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ data });
});

// ─── 정적 파일 서빙 (웹 UI) ────────────────────────────────
const webDistDir = join(__dirname, "..", "dist-web");
app.use(express.static(webDistDir));
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});
app.get("*", (_req, res) => {
  res.sendFile(join(webDistDir, "index.html"));
});

// ─── 종료 핸들러 ───────────────────────────────────────────
async function shutdown() {
  console.log("\n🛑 서버 종료 중... 모든 크롤러 정지");
  await manager.stopAll();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ─── 시작 ─────────────────────────────────────────────────
mkdirSync(config.dataDir, { recursive: true });

app.listen(config.port, async () => {
  console.log(`\n🚀 크롤러 서버 시작 (port: ${config.port})`);

  const tasks = await store.getTasks();
  const isRunning = await store.isRunning();
  console.log(`📋 저장된 작업: ${tasks.length}개`);
  console.log(`🌐 웹 UI: http://localhost:${config.port}`);

  if (isRunning && tasks.length > 0) {
    console.log("▶️  이전 실행 상태 복원 — 큐 재시작");
    // 실행 중이었던 작업을 idle로 초기화한 뒤 재시작
    for (const task of tasks.filter((t) => t.status === "running")) {
      await store.updateTaskStatus(task.id, "idle", { workerSlotId: undefined });
    }
    manager.startQueue().catch(console.error);
  }
});
