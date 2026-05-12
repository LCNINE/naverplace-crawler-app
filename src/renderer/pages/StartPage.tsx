import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SEOUL, SEOUL_DISTRICT_NAMES, CITIES } from "../lib/seoul";

type Mode = "all_korea" | "single";

interface PrevSession {
  mode?: Mode;
  city?: string;
  district?: string;
  dong?: string;
  cityIndex?: number;
  districtIndex?: number;
  dongIndex?: number;
  page: number;
  listIndex: number;
  processed: number;
  status: string;
}

export default function StartPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("all_korea");
  const [keyword, setKeyword] = useState("");
  const [city, setCity] = useState(CITIES[0]);
  const [district, setDistrict] = useState(SEOUL_DISTRICT_NAMES[0]);
  const [dong, setDong] = useState(SEOUL[SEOUL_DISTRICT_NAMES[0]][0]);
  const [headful, setHeadful] = useState(true);
  const [slowMo, setSlowMo] = useState(0);
  const [collectMenu, setCollectMenu] = useState(false);
  const [prev, setPrev] = useState<PrevSession | null>(null);
  const [resume, setResume] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableModal, setTableModal] = useState<null | {
    sql: string;
    canAuto: boolean;
  }>(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const dongs = useMemo(() => SEOUL[district] ?? [], [district]);

  // 마지막 폼 값 복원
  useEffect(() => {
    (async () => {
      try {
        const prefs = await window.api.invoke<{
          lastForm?: {
            mode?: Mode;
            keyword?: string;
            city?: string;
            district?: string;
            dong?: string;
            headful?: boolean;
            slowMo?: number;
            collectMenu?: boolean;
          };
        }>("prefs:get");
        const f = prefs?.lastForm;
        if (f) {
          if (f.mode === "single" || f.mode === "all_korea") setMode(f.mode);
          if (f.keyword) setKeyword(f.keyword);
          if (f.city && CITIES.includes(f.city)) setCity(f.city);
          if (f.district && SEOUL_DISTRICT_NAMES.includes(f.district)) {
            setDistrict(f.district);
            if (f.dong && (SEOUL[f.district] ?? []).includes(f.dong)) {
              setDong(f.dong);
            }
          }
          if (typeof f.headful === "boolean") setHeadful(f.headful);
          if (typeof f.slowMo === "number") setSlowMo(f.slowMo);
          if (typeof f.collectMenu === "boolean") setCollectMenu(f.collectMenu);
        }
      } catch {
        /* ignore */
      } finally {
        setPrefsLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!prefsLoaded) return;
    if (!dongs.includes(dong)) setDong(dongs[0] ?? "");
  }, [district, dongs, dong, prefsLoaded]);

  // 검색 조건이 바뀔 때마다 progress 확인
  useEffect(() => {
    if (!keyword) {
      setPrev(null);
      return;
    }
    if (mode === "single" && (!city || !district || !dong)) {
      setPrev(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await window.api.invoke<{ session?: PrevSession }>(
          "progress:get",
          mode === "all_korea"
            ? { mode, keyword, city: "", district: "", dong: "" }
            : { mode, keyword, city, district, dong }
        );
        if (cancelled) return;
        setPrev(res.session ?? null);
        if (!res.session) setResume(false);
      } catch {
        setPrev(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, keyword, city, district, dong]);

  const onClearProgress = async () => {
    if (!keyword) return;
    const ok = window.confirm(
      "이 검색의 저장된 진행분을 삭제하시겠습니까?\n다음 시작 시 처음부터 크롤링됩니다."
    );
    if (!ok) return;
    try {
      await window.api.invoke("progress:clear", {
        mode,
        keyword,
        city: mode === "all_korea" ? "" : city,
        district: mode === "all_korea" ? "" : district,
        dong: mode === "all_korea" ? "" : dong,
      });
      setPrev(null);
      setResume(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onStart = async () => {
    setBusy(true);
    setError(null);
    try {
      window.api
        .invoke("prefs:setLastForm", {
          mode,
          keyword,
          city,
          district,
          dong,
          headful,
          slowMo,
          collectMenu,
        })
        .catch(() => {});

      const sec = await window.api.invoke<{
        url: string;
        anonKey: string;
        table: string;
        hasServiceKey: boolean;
      }>("secrets:load");
      if (!sec.url || !sec.anonKey || !sec.table) {
        setError("환경설정에서 Supabase 자격증명을 먼저 저장해 주세요.");
        return;
      }

      const pre = await window.api.invoke<{
        tableExists: boolean;
        error?: string;
      }>("crawler:preflight", { table: sec.table });

      if (!pre.tableExists) {
        const created = await window.api.invoke<{
          ok: boolean;
          sql?: string;
          error?: string;
        }>("crawler:create-table", {
          table: sec.table,
          useServiceKey: sec.hasServiceKey,
        });
        if (!created.ok) {
          setTableModal({
            sql: created.sql ?? "",
            canAuto: sec.hasServiceKey,
          });
          return;
        }
      }

      const payload =
        mode === "all_korea"
          ? {
              mode,
              keyword,
              headful,
              slowMo,
              collectMenu,
              resume: !!(resume && prev),
            }
          : {
              mode,
              keyword,
              city,
              district,
              dong,
              headful,
              slowMo,
              collectMenu,
              resume: !!(resume && prev),
            };

      const start = await window.api.invoke<{ sessionId: string }>(
        "crawler:start",
        payload
      );
      navigate(`/progress/${start.sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const canStart =
    !busy &&
    !!keyword &&
    (mode === "all_korea" ? true : !!(city && district && dong));

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <h2 className="text-xl font-semibold text-slate-100">크롤링 시작</h2>

      {/* 모드 선택 탭 */}
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-1 text-sm">
        <button
          onClick={() => setMode("all_korea")}
          className={`rounded-md px-3 py-2 font-medium ${
            mode === "all_korea"
              ? "bg-indigo-500 text-white shadow"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          🌐 전국 자동 순회
        </button>
        <button
          onClick={() => setMode("single")}
          className={`rounded-md px-3 py-2 font-medium ${
            mode === "single"
              ? "bg-indigo-500 text-white shadow"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          📍 단일 지역
        </button>
      </div>

      <Field label="검색어">
        <input
          className="input"
          placeholder="예: 헬스장, 꽃집, 카페"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </Field>

      {mode === "all_korea" ? (
        <div className="rounded border border-slate-800 bg-slate-900/40 px-4 py-3 text-xs text-slate-400">
          <p className="font-medium text-slate-300">
            전국 17개 시/도 → 구/시 → 동을 자동 순회합니다.
          </p>
          <p className="mt-1">
            데이터 양이 매우 많아 수 시간~수 일 걸릴 수 있습니다. 중지하면 위치가
            저장되어 이어서 재개 가능.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="시 / 도">
            <select
              className="input"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            >
              {CITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="구">
            <select
              className="input"
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
            >
              {SEOUL_DISTRICT_NAMES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
          <Field label="동">
            <select
              className="input"
              value={dong}
              onChange={(e) => setDong(e.target.value)}
            >
              {dongs.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={headful}
            onChange={(e) => setHeadful(e.target.checked)}
          />
          브라우저 창 표시 (headful)
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          SlowMo (ms · 1000=1초)
          <input
            type="number"
            min={0}
            max={60000}
            step={100}
            className="input w-28"
            value={slowMo}
            onChange={(e) => setSlowMo(Number(e.target.value) || 0)}
          />
          <span className="text-xs text-slate-500">
            = {(slowMo / 1000).toFixed(slowMo % 1000 === 0 ? 0 : 1)}초
          </span>
        </label>
        <label
          className="flex items-center gap-2 text-sm text-slate-300"
          title="네일/왁싱/속눈썹처럼 메뉴가 없는 업종이면 끄세요. 가게당 5~10초 절약됩니다."
        >
          <input
            type="checkbox"
            checked={collectMenu}
            onChange={(e) => setCollectMenu(e.target.checked)}
          />
          대표메뉴 수집
        </label>
      </div>

      {prev && (
        <div className="rounded border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium text-indigo-200">
                🔄 이전 진행분 발견 ({prev.status})
              </div>
              <div className="mt-1 text-xs text-indigo-300/80">
                {mode === "all_korea" && prev.city && prev.district && prev.dong
                  ? `${prev.city} ${prev.district} ${prev.dong} · `
                  : ""}
                Page {prev.page} / {prev.listIndex}번째 · 누적{" "}
                {prev.processed}건 완료
              </div>
            </div>
            <button
              type="button"
              onClick={onClearProgress}
              className="shrink-0 rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-200 hover:bg-rose-500/20"
            >
              🗑 처음부터
            </button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-indigo-100">
            <input
              type="checkbox"
              checked={resume}
              onChange={(e) => setResume(e.target.checked)}
            />
            이어서 계속하기
          </label>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          className="btn-primary"
          disabled={!canStart}
          onClick={onStart}
        >
          {busy ? "준비 중..." : "▶ 시작"}
        </button>
      </div>

      {error && <p className="text-sm text-rose-400">✗ {error}</p>}

      {tableModal && (
        <TableMissingModal
          sql={tableModal.sql}
          canAuto={tableModal.canAuto}
          onClose={() => setTableModal(null)}
        />
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">
        {label}
      </span>
      {children}
    </label>
  );
}

function TableMissingModal({
  sql,
  canAuto,
  onClose,
}: {
  sql: string;
  canAuto: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-100">
          테이블이 존재하지 않습니다
        </h3>
        <p className="mt-1 text-sm text-slate-400">
          {canAuto
            ? "Service Role Key로 자동 생성을 시도했지만 실패했습니다. 아래 SQL을 Supabase 콘솔(SQL Editor)에 직접 실행해 주세요."
            : "아래 SQL을 Supabase 콘솔(SQL Editor)에 붙여넣고 실행해 주세요. 또는 환경설정에서 Service Role Key를 입력하면 자동 생성을 시도합니다."}
        </p>
        <pre className="scrollbar-thin mt-3 max-h-72 overflow-auto rounded border border-slate-700 bg-slate-950 p-3 text-xs text-slate-200">
          {sql}
        </pre>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            className="btn-secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(sql);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "복사됨 ✓" : "SQL 복사"}
          </button>
          <button className="btn-primary" onClick={onClose}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
