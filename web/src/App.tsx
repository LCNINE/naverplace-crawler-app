import { useState, useEffect } from "react";
import { Toaster } from "sonner";
import { useQueueState } from "./hooks/useQueueState";
import { Dashboard } from "./components/Dashboard";
import { TaskManager } from "./components/TaskManager";
import { LoginPage } from "./components/LoginPage";
import { api, api2, getAuthToken, setAuthToken } from "./api";

type Tab = "dashboard" | "tasks";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "대시보드" },
  { id: "tasks", label: "작업 관리" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [activeContainer, setActiveContainer] = useState<1 | 2>(1);
  const [authed, setAuthed] = useState(() => !!getAuthToken());
  const { state, error, refresh: refresh1 } = useQueueState(api);
  const { state: state2, error: error2, refresh: refresh2 } = useQueueState(api2);

  const refresh = () => { refresh1(); refresh2(); };

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
                C1 {state.running ? "실행 중" : "정지"}
              </span>
            )}
            {api2 && state2 && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  state2.running
                    ? "bg-green-900/60 text-green-300"
                    : "bg-gray-700 text-gray-400"
                }`}
              >
                C2 {state2.running ? "실행 중" : "정지"}
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
              <Dashboard
                state={state}
                onRefresh={refresh1}
                apiClient={api}
                state2={state2}
                onRefresh2={refresh2}
                apiClient2={api2}
              />
            )}
            {tab === "tasks" && (
              <div className="flex flex-col gap-4">
                {api2 && (
                  <div className="flex gap-1 p-1 bg-gray-800 rounded-lg self-start">
                    <button
                      onClick={() => setActiveContainer(1)}
                      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeContainer === 1 ? "bg-gray-600 text-white" : "text-gray-400 hover:text-white"}`}
                    >
                      컨테이너 1
                    </button>
                    <button
                      onClick={() => setActiveContainer(2)}
                      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeContainer === 2 ? "bg-gray-600 text-white" : "text-gray-400 hover:text-white"}`}
                    >
                      컨테이너 2
                    </button>
                  </div>
                )}
                {activeContainer === 1 ? (
                  <TaskManager tasks={state.tasks} onRefresh={refresh1} apiClient={api} />
                ) : (
                  state2
                    ? <TaskManager tasks={state2.tasks} onRefresh={refresh2} apiClient={api2!} />
                    : error2
                      ? <div className="text-center py-12 text-red-400 text-sm">컨테이너 2 연결 실패: {error2}</div>
                      : <div className="text-center py-12 text-gray-500">컨테이너 2 연결 중...</div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
