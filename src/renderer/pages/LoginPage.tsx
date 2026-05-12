import { useEffect, useState } from "react";

const REMEMBER_KEY = "crawler-app:rememberedEmail";

interface Props {
  onSignedIn: (user: { id: string; email: string }) => void;
}

export default function LoginPage({ onSignedIn }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 마지막 로그인 이메일 복원
  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_KEY);
      if (saved) {
        setEmail(saved);
        setRemember(true);
      } else {
        setRemember(false);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.api.invoke<
        | { ok: true; user: { id: string; email: string } }
        | { ok: false; error: string }
      >("auth:signIn", { email: email.trim(), password });
      if (res.ok) {
        try {
          if (remember) {
            localStorage.setItem(REMEMBER_KEY, email.trim());
          } else {
            localStorage.removeItem(REMEMBER_KEY);
          }
        } catch {
          /* ignore */
        }
        onSignedIn(res.user);
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center px-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-5 rounded-xl border border-slate-800 bg-slate-900/50 p-6 shadow-xl"
      >
        <div>
          <h2 className="text-lg font-semibold text-slate-100">
            🔐 로그인
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            NaverPlace Crawler를 사용하려면 로그인이 필요합니다.
          </p>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-400">
            이메일
          </span>
          <input
            className="input"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-400">
            비밀번호
          </span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </label>

        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            disabled={busy}
          />
          아이디 기억하기
        </label>

        <button
          type="submit"
          className="btn-primary w-full"
          disabled={busy || !email || !password}
        >
          {busy ? "로그인 중..." : "로그인"}
        </button>

        {error && (
          <p className="rounded bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            ✗ {error}
          </p>
        )}
      </form>
    </div>
  );
}
