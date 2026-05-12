import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

interface LogEvent {
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  msg: string;
  time: number;
  ctx?: Record<string, unknown>;
}

interface ProgressEvent {
  sessionId: string;
  mode?: "single" | "all_korea";
  city?: string;
  district?: string;
  dong?: string;
  cityIndex?: number;
  districtIndex?: number;
  dongIndex?: number;
  page: number;
  listIndex: number;
  processed: number;
}

const MAX_LOGS = 500;

const LEVEL_COLOR: Record<LogEvent["level"], string> = {
  trace: "text-slate-500",
  debug: "text-slate-400",
  info: "text-slate-200",
  warn: "text-amber-300",
  error: "text-rose-400",
  fatal: "text-rose-500",
};

export default function ProgressPage() {
  const { sessionId = "" } = useParams();
  const navigate = useNavigate();
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [done, setDone] = useState<{ ok: boolean; error?: string } | null>(
    null
  );
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(Date.now());
  const logBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    startedAt.current = Date.now();
    const id = setInterval(
      () => setElapsed(Date.now() - startedAt.current),
      1000
    );
    return () => clearInterval(id);
  }, [sessionId]);

  // mount 시 백로그 로드 (다른 탭 갔다가 돌아왔을 때 이전 로그 복원)
  useEffect(() => {
    (async () => {
      try {
        const backlog = await window.api.invoke<LogEvent[]>("logs:recent");
        if (Array.isArray(backlog) && backlog.length > 0) {
          setLogs(backlog.slice(-MAX_LOGS));
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    const offLog = window.api.on("crawler:log", (raw) => {
      const ev = raw as LogEvent;
      setLogs((prev) => {
        const next = [...prev, ev];
        return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
      });
    });
    const offProg = window.api.on("crawler:progress", (raw) => {
      const ev = raw as ProgressEvent;
      if (ev.sessionId !== sessionId) return;
      setProgress(ev);
    });
    const offDone = window.api.on("crawler:done", (raw) => {
      const ev = raw as { sessionId: string; ok: boolean; error?: string };
      if (ev.sessionId !== sessionId) return;
      setDone({ ok: ev.ok, error: ev.error });
    });
    return () => {
      offLog();
      offProg();
      offDone();
    };
  }, [sessionId]);

  useEffect(() => {
    const box = logBoxRef.current;
    if (!box) return;
    const atBottom =
      box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    if (atBottom) box.scrollTop = box.scrollHeight;
  }, [logs.length]);

  const onStop = async () => {
    await window.api.invoke("crawler:stop", { sessionId });
  };

  const onClearLogs = async () => {
    try {
      await window.api.invoke("logs:clear");
    } catch {
      /* ignore */
    }
    setLogs([]);
  };

  return (
    <div className="flex h-full flex-col gap-4 px-6 py-6">
      <div className="flex flex-wrap items-center gap-4 rounded border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm">
        {progress?.city && (
          <Stat
            label="위치"
            value={`${progress.city} ${progress.district ?? ""} ${
              progress.dong ?? ""
            }`.trim()}
          />
        )}
        <Stat label="페이지" value={String(progress?.page ?? 1)} />
        <Stat
          label="리스트 인덱스"
          value={String(progress?.listIndex ?? 0)}
        />
        <Stat label="처리 건수" value={String(progress?.processed ?? 0)} />
        <Stat label="경과" value={fmtElapsed(elapsed)} />
        <div className="ml-auto flex items-center gap-2">
          <button
            className="btn-ghost text-xs"
            onClick={() => navigate("/activity")}
            title="활동로그 페이지로 — 다시 돌아올 수 있음"
          >
            ← 활동로그
          </button>
          {done ? (
            <>
              <span
                className={
                  done.ok ? "text-emerald-300" : "text-rose-300"
                }
              >
                {done.ok ? "✅ 완료/중지" : `❌ 실패: ${done.error}`}
              </span>
              <button
                className="btn-secondary"
                onClick={() => navigate("/start")}
              >
                새 크롤링
              </button>
            </>
          ) : (
            <button className="btn-danger" onClick={onStop}>
              ■ 중지
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>로그 ({logs.length}건)</span>
        <button
          onClick={onClearLogs}
          className="rounded border border-slate-700 bg-slate-800/60 px-2 py-1 text-slate-400 hover:border-rose-500/40 hover:text-rose-300"
          title="화면과 메모리의 로그 버퍼 모두 비움"
        >
          🗑 로그 지우기
        </button>
      </div>

      <div
        ref={logBoxRef}
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto rounded border border-slate-800 bg-slate-950/80 p-3 font-mono text-xs"
      >
        {logs.length === 0 ? (
          <div className="text-slate-500">대기 중...</div>
        ) : (
          logs.map((l, i) => (
            <div key={i} className={`whitespace-pre-wrap ${LEVEL_COLOR[l.level]}`}>
              <span className="mr-2 text-slate-600">
                {new Date(l.time).toLocaleTimeString()}
              </span>
              {l.msg}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className="text-base font-semibold tabular-nums text-slate-100">
        {value}
      </span>
    </div>
  );
}

function fmtElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
