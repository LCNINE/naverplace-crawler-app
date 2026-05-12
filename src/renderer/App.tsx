import { useEffect, useState } from "react";
import { Routes, Route, Navigate, NavLink } from "react-router-dom";
import SettingsPage from "./pages/SettingsPage";
import StartPage from "./pages/StartPage";
import ProgressPage from "./pages/ProgressPage";
import ActivityPage from "./pages/ActivityPage";
import LoginPage from "./pages/LoginPage";

interface AuthUser {
  id: string;
  email: string;
}

export default function App() {
  const [bootChecked, setBootChecked] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [hasSecrets, setHasSecrets] = useState(false);
  const [activeCount, setActiveCount] = useState(0);

  // 부트 시: 세션 복원 시도
  useEffect(() => {
    (async () => {
      try {
        const res = await window.api.invoke<{ user: AuthUser | null }>(
          "auth:restore"
        );
        if (res.user) setUser(res.user);
      } catch {
        /* ignore */
      } finally {
        setBootChecked(true);
      }
    })();
  }, []);

  // 로그인 후: secrets 존재 여부 확인
  useEffect(() => {
    if (!user) {
      setHasSecrets(false);
      return;
    }
    (async () => {
      try {
        const res = await window.api.invoke<{
          url: string;
          anonKey: string;
          table: string;
        }>("secrets:load");
        setHasSecrets(!!(res?.url && res?.anonKey && res?.table));
      } catch {
        setHasSecrets(false);
      }
    })();
  }, [user]);

  // 활성 세션 폴링
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const tick = async () => {
      try {
        const list = await window.api.invoke<unknown[]>("sessions:listActive");
        if (alive) setActiveCount(Array.isArray(list) ? list.length : 0);
      } catch {
        /* ignore */
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [user]);

  const onSignOut = async () => {
    await window.api.invoke("auth:signOut");
    setUser(null);
  };

  if (!bootChecked) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        Loading...
      </div>
    );
  }

  if (!user) {
    return <LoginPage onSignedIn={setUser} />;
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-800 bg-slate-900/60 px-4 py-3">
        <h1 className="text-sm font-semibold tracking-tight text-slate-200">
          🗺️ NaverPlace Crawler
        </h1>
        <nav className="flex items-center gap-2 text-xs">
          <NavLink
            to="/start"
            className={({ isActive }) =>
              `rounded px-2 py-1 ${
                isActive
                  ? "bg-indigo-500/30 text-indigo-200"
                  : "text-slate-400 hover:text-slate-200"
              }`
            }
          >
            크롤링
          </NavLink>
          <NavLink
            to="/activity"
            className={({ isActive }) =>
              `relative rounded px-2 py-1 ${
                isActive
                  ? "bg-indigo-500/30 text-indigo-200"
                  : "text-slate-400 hover:text-slate-200"
              }`
            }
          >
            활동로그
            {activeCount > 0 && (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                {activeCount}
              </span>
            )}
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `rounded px-2 py-1 ${
                isActive
                  ? "bg-indigo-500/30 text-indigo-200"
                  : "text-slate-400 hover:text-slate-200"
              }`
            }
          >
            환경설정
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-xs">
          <span className="text-slate-400">{user.email}</span>
          <button
            onClick={onSignOut}
            className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800"
          >
            로그아웃
          </button>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">
        <Routes>
          <Route
            path="/"
            element={
              hasSecrets ? (
                <Navigate to="/start" replace />
              ) : (
                <Navigate to="/settings" replace />
              )
            }
          />
          <Route
            path="/settings"
            element={
              <SettingsPage
                userEmail={user.email}
                onSaved={() => setHasSecrets(true)}
              />
            }
          />
          <Route path="/start" element={<StartPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/progress/:sessionId" element={<ProgressPage />} />
        </Routes>
      </main>
    </div>
  );
}
