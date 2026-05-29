import { useState, useEffect } from "react";
import type { Task } from "../types";
import type { ApiClient } from "../api";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface Props {
  initial?: Partial<Task>;
  onSubmit: (data: {
    keyword: string;
    table: string;
    slowMo: number;
    collectMenu: boolean;
    extraCategoryKeywords: string[];
  }) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
  apiClient: ApiClient;
}

export function TaskForm({ initial, onSubmit, onCancel, submitLabel = "추가", apiClient }: Props) {
  const [keyword, setKeyword] = useState(initial?.keyword ?? "");
  const [table, setTable] = useState(initial?.table ?? "");
  const [slowMo, setSlowMo] = useState(initial?.slowMo ?? 0);
  const [collectMenu, setCollectMenu] = useState(initial?.collectMenu ?? false);
  const [extraKeywords, setExtraKeywords] = useState(
    initial?.extraCategoryKeywords?.join(", ") ?? ""
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usedTables, setUsedTables] = useState<string[]>([]);
  const [otherTables, setOtherTables] = useState<string[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);

  useEffect(() => {
    apiClient.getTables()
      .then((res) => {
        setUsedTables(res.usedTables);
        setOtherTables(res.otherTables);
      })
      .catch(() => {})
      .finally(() => setTablesLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyword.trim() || !table.trim()) {
      setError("키워드와 테이블명은 필수입니다.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onSubmit({
        keyword: keyword.trim(),
        table: table.trim(),
        slowMo,
        collectMenu,
        extraCategoryKeywords: extraKeywords
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className="block text-sm text-gray-400 mb-1">검색 키워드 *</label>
        <input
          className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          placeholder="예: 헤어, 네일, 빨래방"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          required
        />
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1">카테고리 매칭 키워드</label>
        <input
          className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          placeholder="예: 빨래, 코인, 셀프 (비어있으면 전체 포함)"
          value={extraKeywords}
          onChange={(e) => setExtraKeywords(e.target.value)}
        />
        <p className="text-xs text-gray-500 mt-1">
          쉼표로 구분. 비어있으면 키워드와 일치하는 모든 가게를 수집합니다.
        </p>
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1">Supabase 테이블명 *</label>
        <TableSelect
          value={table}
          onChange={setTable}
          usedTables={usedTables}
          otherTables={otherTables}
          loading={tablesLoading}
        />
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1">
          요청 지연 (slowMo): <span className="text-white font-mono">{slowMo}ms</span>
        </label>
        <input
          type="range"
          min={0}
          max={5000}
          step={100}
          value={slowMo}
          onChange={(e) => setSlowMo(Number(e.target.value))}
          className="w-full accent-blue-500"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-0.5">
          <span>0 (빠름)</span>
          <span>5000ms (느림)</span>
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={collectMenu}
          onChange={(e) => setCollectMenu(e.target.checked)}
          className="accent-blue-500 w-4 h-4"
        />
        <span className="text-sm text-gray-300">대표 메뉴 수집 (속도 느려짐)</span>
      </label>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="flex gap-3 pt-1">
        <button
          type="submit"
          disabled={loading}
          className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-semibold transition-colors"
        >
          {loading ? "처리 중..." : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg py-2 text-sm transition-colors"
        >
          취소
        </button>
      </div>
    </form>
  );
}

// ─── 테이블 Select 컴포넌트 ────────────────────────────────
// tables 배열의 앞부분(usedTables)과 뒷부분(otherTables)을 서버가 구분해서 내려주므로
// 서버 응답 그대로 사용. 앞 N개 = 기존 작업 테이블(헤더: "사용 중인 테이블"),
// 나머지 = 전체 테이블(헤더: "전체 테이블").
// 서버에서 분리 정보를 내려주지 않으므로, 간단히 전체를 하나의 목록으로 표시.

interface TableSelectProps {
  value: string;
  onChange: (v: string) => void;
  usedTables: string[];
  otherTables: string[];
  loading: boolean;
}

function TableSelect({ value, onChange, usedTables, otherTables, loading }: TableSelectProps) {
  if (loading) {
    return (
      <div className="h-9 w-full rounded-lg border border-gray-600 bg-gray-900 px-3 flex items-center">
        <span className="text-gray-500 text-sm">테이블 불러오는 중...</span>
      </div>
    );
  }

  const allEmpty = usedTables.length === 0 && otherTables.length === 0;

  if (allEmpty) {
    return (
      <input
        className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
        placeholder="예: places_hair_v2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      />
    );
  }

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="테이블 선택" />
      </SelectTrigger>
      <SelectContent>
        {usedTables.length > 0 && (
          <SelectGroup>
            <SelectLabel>사용 중인 테이블</SelectLabel>
            {usedTables.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectGroup>
        )}
        {usedTables.length > 0 && otherTables.length > 0 && <SelectSeparator />}
        {otherTables.length > 0 && (
          <SelectGroup>
            <SelectLabel>전체 테이블</SelectLabel>
            {otherTables.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
