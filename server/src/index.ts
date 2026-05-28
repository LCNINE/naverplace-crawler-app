import express from "express";
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

// ─── 테이블 목록 API ───────────────────────────────────────
app.get("/api/tables", async (_req, res) => {
  try {
    // PostgREST OpenAPI 스펙에서 전체 테이블 목록 추출
    const r = await fetch(`${config.supabase.url}/rest/v1/`, {
      headers: {
        apikey: config.supabase.anonKey,
        Authorization: `Bearer ${config.supabase.anonKey}`,
        Accept: "application/openapi+json",
      },
    });
    if (!r.ok) throw new Error(`PostgREST 응답 오류: ${r.status}`);
    const spec = (await r.json()) as { definitions?: Record<string, unknown> };
    const allTables = Object.keys(spec.definitions ?? {})
      .filter((t) => !t.startsWith("rpc/"))
      .sort();

    // 기존 task에서 사용 중인 테이블을 앞 그룹으로 분리
    const tasks = await store.getTasks();
    const usedTables = [...new Set(tasks.map((t) => t.table))].sort();
    const otherTables = allTables.filter((t) => !usedTables.includes(t));

    res.json({ usedTables, otherTables });
  } catch {
    // 실패 시 task store 테이블만 반환
    const tasks = await store.getTasks();
    const usedTables = [...new Set(tasks.map((t) => t.table))].sort();
    res.json({ usedTables, otherTables: [] });
  }
});

// ─── 분석 API ──────────────────────────────────────────────

const isV2Table = (table: string) => /_v2$/i.test(table);

async function getAnalysisClient() {
  return createClient(config.supabase.url, config.supabase.anonKey);
}

async function validateAnalysisTable(tableName: string, res: express.Response): Promise<boolean> {
  const tasks = await store.getTasks();
  const allowed = tasks.some((t) => t.table === tableName);
  if (!allowed) {
    res.status(403).json({ error: "등록된 작업의 테이블만 조회할 수 있습니다." });
    return false;
  }
  if (!isV2Table(tableName)) {
    res.status(400).json({ error: "v2_required", message: "v2 테이블(_v2 suffix)에서만 분석이 지원됩니다." });
    return false;
  }
  return true;
}

app.get("/api/analysis/:table/new-shops", async (req, res) => {
  if (!(await validateAnalysisTable(req.params.table, res))) return;
  const since = req.query.since
    ? new Date(String(req.query.since)).toISOString()
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const client = await getAnalysisClient();
  let query = client
    .from(req.params.table)
    .select("shop_name, place_id, address, phone, category_main, category_sub, city, district, dong, naver_place_url, first_seen_at")
    .gte("first_seen_at", since)
    .order("first_seen_at", { ascending: false })
    .limit(500);

  if (req.query.keyword) {
    query = query.ilike("naver_search", `%${req.query.keyword}%`);
  }

  const { data, error } = await query;
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ data });
});

app.get("/api/analysis/:table/missing-shops", async (req, res) => {
  if (!(await validateAnalysisTable(req.params.table, res))) return;

  const client = await getAnalysisClient();
  let query = client
    .from(req.params.table)
    .select("shop_name, place_id, address, phone, category_main, category_sub, city, district, dong, naver_place_url, missing_at, last_seen_at")
    .eq("status", "missing")
    .order("missing_at", { ascending: false })
    .limit(500);

  if (req.query.keyword) {
    query = query.ilike("naver_search", `%${req.query.keyword}%`);
  }

  const { data, error } = await query;
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ data });
});

app.get("/api/analysis/:table/events", async (req, res) => {
  if (!(await validateAnalysisTable(req.params.table, res))) return;
  const since = req.query.since
    ? new Date(String(req.query.since)).toISOString()
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const client = await getAnalysisClient();
  let query = client
    .from("shop_events")
    .select("*")
    .eq("table_name", req.params.table)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(500);

  if (req.query.event_type) {
    query = query.eq("event_type", String(req.query.event_type));
  }

  const { data, error } = await query;
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
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
