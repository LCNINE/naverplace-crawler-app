import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

interface ActiveSession {
  sessionId: string;
  state: {
    city: string;
    district: string;
    dong: string;
    page: number;
    listIndex: number;
    processed: number;
    cityIndex: number;
    districtIndex: number;
    dongIndex: number;
  };
}

interface SavedSession {
  mode?: "single" | "all_korea";
  keyword: string;
  city: string;
  district: string;
  dong: string;
  page: number;
  listIndex: number;
  processed: number;
  status: "running" | "stopped" | "completed" | "error";
  updatedAt: string;
  error?: string;
}

export default function ActivityPage() {
  const navigate = useNavigate();
  const [active, setActive] = useState<ActiveSession[]>([]);
  const [saved, setSaved] = useState<Record<string, SavedSession>>({});
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const [act, all] = await Promise.all([
        window.api.invoke<ActiveSession[]>("sessions:listActive"),
        window.api.invoke<Record<string, SavedSession>>("progress:listAll"),
      ]);
      setActive(act ?? []);
      setSaved(all ?? {});
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, []);

  const onClearSession = async (s: SavedSession) => {
    if (!confirm(`'${s.keyword}' 진행 기록을 삭제하시겠습니까?`)) return;
    await window.api.invoke("progress:clear", {
      keyword: s.keyword,
      city: s.mode === "all_korea" ? "" : s.city,
      district: s.mode === "all_korea" ? "" : s.district,
      dong: s.mode === "all_korea" ? "" : s.dong,
    });
    refresh();
  };

  const savedEntries = Object.entries(saved).sort(
    (a, b) =>
      new Date(b[1].updatedAt).getTime() - new Date(a[1].updatedAt).getTime()
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">활동로그</h2>
          <p className="mt-1 text-sm text-slate-400">
            현재 진행 중인 크롤링과 저장된 진행 기록.
          </p>
        </div>
        <button onClick={refresh} className="btn-ghost text-xs">
          새로고침
        </button>
      </div>

      {/* 진행 중 세션 */}
      <section>
        <h3 className="mb-2 text-sm font-medium text-slate-300">
          ▶ 진행 중 ({active.length})
        </h3>
        {active.length === 0 ? (
          <div className="rounded border border-slate-800 bg-slate-900/40 px-4 py-6 text-center text-sm text-slate-500">
            진행 중인 크롤링이 없습니다.
            <div className="mt-2">
              <Link to="/start" className="text-indigo-400 hover:underline">
                새 크롤링 시작 →
              </Link>
            </div>
          </div>
        ) : (
          <ul className="space-y-2">
            {active.map((s) => (
              <li
                key={s.sessionId}
                onClick={() => navigate(`/progress/${s.sessionId}`)}
                className="cursor-pointer rounded border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 transition hover:border-emerald-400/60 hover:bg-emerald-500/10"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                    <span className="text-sm font-medium text-emerald-200">
                      {s.state.city} {s.state.district} {s.state.dong}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">
                    page {s.state.page} · #{s.state.listIndex} · 누적{" "}
                    <span className="font-semibold text-slate-200">
                      {s.state.processed}건
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 저장된 진행 기록 */}
      <section>
        <h3 className="mb-2 text-sm font-medium text-slate-300">
          📚 진행 기록 ({savedEntries.length})
        </h3>
        {loading ? (
          <p className="text-sm text-slate-500">불러오는 중...</p>
        ) : savedEntries.length === 0 ? (
          <div className="rounded border border-slate-800 bg-slate-900/40 px-4 py-6 text-center text-sm text-slate-500">
            아직 진행 기록이 없습니다.
          </div>
        ) : (
          <ul className="space-y-2">
            {savedEntries.map(([key, s]) => (
              <li
                key={key}
                className="flex items-center justify-between rounded border border-slate-800 bg-slate-900/40 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <StatusPill status={s.status} />
                    <span className="text-sm font-medium text-slate-100">
                      {s.keyword}
                    </span>
                    <span className="text-xs text-slate-500">
                      {s.mode === "all_korea"
                        ? "🌐 전국"
                        : `📍 ${s.city} ${s.district} ${s.dong}`}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {s.mode === "all_korea" && (s.city || s.district || s.dong)
                      ? `현재: ${s.city} ${s.district} ${s.dong} · `
                      : ""}
                    page {s.page} · idx {s.listIndex} · 누적 {s.processed}건 ·{" "}
                    {new Date(s.updatedAt).toLocaleString("ko-KR")}
                  </div>
                  {s.error && (
                    <div className="mt-1 truncate text-xs text-rose-400">
                      {s.error}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => onClearSession(s)}
                  className="btn-ghost ml-3 text-xs text-slate-500 hover:text-rose-400"
                  title="이 진행 기록 삭제"
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: SavedSession["status"] }) {
  const map: Record<SavedSession["status"], { label: string; cls: string }> = {
    running: {
      label: "진행 중",
      cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    },
    stopped: {
      label: "중지됨",
      cls: "bg-slate-500/20 text-slate-300 border-slate-500/40",
    },
    completed: {
      label: "완료",
      cls: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40",
    },
    error: {
      label: "에러",
      cls: "bg-rose-500/20 text-rose-300 border-rose-500/40",
    },
  };
  const m = map[status];
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${m.cls}`}
    >
      {m.label}
    </span>
  );
}
