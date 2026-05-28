import { useState, useEffect } from "react";
import type { Task } from "../types";
import { api } from "../api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface Props {
  tasks: Task[];
}

type AnalysisType = "new-shops" | "missing-shops" | "reappeared";

const PERIODS = [
  { label: "7일", days: 7 },
  { label: "30일", days: 30 },
  { label: "90일", days: 90 },
];

function exportCsv(data: Record<string, unknown>[], filename: string) {
  if (!data.length) return;
  const keys = Object.keys(data[0]);
  const rows = [
    keys.join(","),
    ...data.map((row) =>
      keys.map((k) => JSON.stringify(row[k] ?? "")).join(",")
    ),
  ];
  const blob = new Blob(["﻿" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const COLS: Record<AnalysisType, string[]> = {
  "new-shops": ["shop_name", "category_main", "city", "district", "dong", "phone", "address", "first_seen_at"],
  "missing-shops": ["shop_name", "category_main", "city", "district", "dong", "phone", "address", "missing_at", "last_seen_at"],
  reappeared: ["shop_name", "event_type", "created_at"],
};

const COL_LABELS: Record<string, string> = {
  shop_name: "상호명",
  category_main: "카테고리",
  city: "시/도",
  district: "구/군",
  dong: "동",
  phone: "전화번호",
  address: "주소",
  first_seen_at: "최초 발견",
  missing_at: "사라진 날짜",
  last_seen_at: "마지막 발견",
  event_type: "이벤트",
  created_at: "날짜",
};

export function AnalysisPage({ tasks }: Props) {
  const taskV2Tables = [...new Set(tasks.map((t) => t.table).filter((t) => t.endsWith("_v2")))];
  const [allV2Tables, setAllV2Tables] = useState<string[]>(taskV2Tables);
  const [selectedTable, setSelectedTable] = useState(taskV2Tables[0] ?? "");
  const [analysisType, setAnalysisType] = useState<AnalysisType>("new-shops");
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getTables().then((res) => {
      const v2 = [...res.usedTables, ...res.otherTables].filter((t) => t.endsWith("_v2"));
      setAllV2Tables(v2);
      if (!selectedTable && v2.length > 0) setSelectedTable(v2[0]);
    }).catch(() => {});
  }, []);

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const handleSearch = async () => {
    if (!selectedTable) return;
    setLoading(true);
    setData(null);
    setError(null);
    try {
      let result: { data: Record<string, unknown>[] };
      if (analysisType === "new-shops") {
        result = await api.getNewShops(selectedTable, since);
      } else if (analysisType === "missing-shops") {
        result = await api.getMissingShops(selectedTable);
      } else {
        result = await api.getEvents(selectedTable, "reappeared", since);
      }
      setData(result.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const cols = COLS[analysisType];

  if (allV2Tables.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>분석 기능은 v2 테이블(_v2 suffix)에서만 지원됩니다.</p>
        <p className="text-sm mt-1">작업 관리에서 테이블명을 <code className="font-mono text-gray-400">places_xxx_v2</code> 형식으로 추가하세요.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* 필터 */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 flex flex-wrap gap-4 items-end">
        <div className="flex flex-col gap-1 min-w-52">
          <label className="text-xs text-gray-400">테이블</label>
          <Select value={selectedTable} onValueChange={setSelectedTable}>
            <SelectTrigger>
              <SelectValue placeholder="테이블 선택" />
            </SelectTrigger>
            <SelectContent>
              {allV2Tables.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400">분석 유형</label>
          <div className="flex gap-2">
            {(["new-shops", "missing-shops", "reappeared"] as AnalysisType[]).map((type) => (
              <button
                key={type}
                onClick={() => setAnalysisType(type)}
                className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                  analysisType === type
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                {type === "new-shops" ? "신규 오픈" : type === "missing-shops" ? "사라진 샵" : "재오픈"}
              </button>
            ))}
          </div>
        </div>

        {analysisType !== "missing-shops" && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">기간</label>
            <div className="flex gap-2">
              {PERIODS.map((p) => (
                <button
                  key={p.days}
                  onClick={() => setDays(p.days)}
                  className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                    days === p.days
                      ? "bg-blue-600 text-white"
                      : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={handleSearch}
          disabled={loading || !selectedTable}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors"
        >
          {loading ? "조회 중..." : "조회"}
        </button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* 결과 */}
      {data !== null && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">
              결과 <span className="text-white font-bold">{data.length.toLocaleString()}</span>건
            </p>
            {data.length > 0 && (
              <button
                onClick={() =>
                  exportCsv(
                    data,
                    `${analysisType}_${selectedTable}_${new Date().toISOString().slice(0, 10)}.csv`
                  )
                }
                className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
                CSV 내보내기
              </button>
            )}
          </div>

          {data.length === 0 ? (
            <p className="text-gray-500 text-sm">결과가 없습니다.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-800 text-gray-400 text-left">
                    {cols.map((col) => (
                      <th key={col} className="px-3 py-2 font-medium whitespace-nowrap">
                        {COL_LABELS[col] ?? col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.map((row, i) => (
                    <tr
                      key={i}
                      className="border-t border-gray-700 hover:bg-gray-800/50 transition-colors"
                    >
                      {cols.map((col) => (
                        <td key={col} className="px-3 py-2 text-gray-200 whitespace-nowrap max-w-xs truncate">
                          {col.endsWith("_at") && row[col]
                            ? new Date(row[col] as string).toLocaleDateString("ko-KR")
                            : String(row[col] ?? "—")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
