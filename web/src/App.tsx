import { useState, useEffect } from "react";
import { Toaster } from "sonner";
import { useQueueState } from "./hooks/useQueueState";
import { Dashboard } from "./components/Dashboard";
import { TaskManager } from "./components/TaskManager";
import { AnalysisPage } from "./components/AnalysisPage";
import { LoginPage } from "./components/LoginPage";
import { getAuthToken, setAuthToken } from "./api";

type Tab = "dashboard" | "tasks" | "analysis";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "대시보드" },
  { id: "tasks", label: "작업 관리" },
  { id: "analysis", label: "분석" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [authed, setAuthed] = useState(() => !!getAuthToken());
  const { state, error, refresh } = useQueueState();

  const handleLogout = () => {
    setAuthToken(null);
    setAuthed(false);
  };

  useEffect(() => {
    window.addEventListener("auth:logout", handleLogout);
    return () => window.removeEventListener("auth:logout", handleLogout);
  }, []);

  if (!authed) {
    return (
      <>
        <Toaster theme="dark" position="top-right" richColors />
        <LoginPage onLogin={() => setAuthed(true)} />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Toaster theme="dark" position="top-right" richColors />
      {/* 헤더 */}
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-white">🕷 크롤러 관리</span>
            {state && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  state.running
                    ? "bg-green-900/60 text-green-300"
                    : "bg-gray-700 text-gray-400"
                }`}
              >
                {state.running ? "실행 중" : "정지"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <nav className="flex gap-1">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    tab === t.id
                      ? "bg-gray-700 text-white"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            <button
              onClick={handleLogout}
              className="ml-2 px-3 py-1.5 rounded-lg text-sm text-gray-500 hover:text-gray-300 transition-colors"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      {/* 메인 */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700/40 text-red-300 text-sm">
            서버 연결 오류: {error}
          </div>
        )}

        {!state ? (
          <div className="text-center py-20 text-gray-500">서버에 연결 중...</div>
        ) : (
          <>
            {tab === "dashboard" && (
              <Dashboard state={state} onRefresh={refresh} />
            )}
            {tab === "tasks" && (
              <TaskManager tasks={state.tasks} onRefresh={refresh} />
            )}
            {tab === "analysis" && (
              <AnalysisPage tasks={state.tasks} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
