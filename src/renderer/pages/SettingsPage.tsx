import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

interface Props {
  onSaved: () => void;
  userEmail?: string;
}

export default function SettingsPage({ onSaved, userEmail }: Props) {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [serviceKey, setServiceKey] = useState("");
  const [table, setTable] = useState("");
  const [chatWebhookUrl, setChatWebhookUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [encryptionAvailable, setEncryptionAvailable] = useState(true);
  const [hasServiceKey, setHasServiceKey] = useState(false);
  const [hasChatWebhook, setHasChatWebhook] = useState(false);
  const [status, setStatus] = useState<{
    kind: "idle" | "saving" | "testing" | "ok" | "error";
    msg?: string;
  }>({ kind: "idle" });

  useEffect(() => {
    (async () => {
      const res = await window.api.invoke<{
        url: string;
        anonKey: string;
        table: string;
        hasServiceKey: boolean;
        hasChatWebhook: boolean;
        encryptionAvailable: boolean;
      }>("secrets:load");
      let nextUrl = res.url;
      let nextAnon = res.anonKey;
      let nextTable = res.table;

      // 비어 있고 로그인 사용자에게 default 매핑 있으면 prefill
      if (userEmail && (!nextUrl || !nextAnon)) {
        try {
          const def = await window.api.invoke<{
            defaults: { url: string; anonKey: string; table: string } | null;
          }>("auth:defaultSettings", { email: userEmail });
          if (def.defaults) {
            if (!nextUrl) nextUrl = def.defaults.url;
            if (!nextAnon) nextAnon = def.defaults.anonKey;
            if (!nextTable) nextTable = def.defaults.table;
          }
        } catch {
          /* ignore */
        }
      }

      setUrl(nextUrl);
      setAnonKey(nextAnon);
      setTable(nextTable);
      setHasServiceKey(res.hasServiceKey);
      setHasChatWebhook(res.hasChatWebhook);
      setEncryptionAvailable(res.encryptionAvailable);
    })();
  }, [userEmail]);

  const onSave = async () => {
    setStatus({ kind: "saving" });
    try {
      await window.api.invoke("secrets:save", {
        url,
        anonKey,
        serviceKey: serviceKey || undefined,
        table,
        chatWebhookUrl: chatWebhookUrl || undefined,
      });
      setStatus({ kind: "ok", msg: "저장 완료" });
      onSaved();
    } catch (e) {
      setStatus({
        kind: "error",
        msg: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const onTest = async () => {
    setStatus({ kind: "testing" });
    await window.api.invoke("secrets:save", {
      url,
      anonKey,
      serviceKey: serviceKey || undefined,
      table,
    });
    const res = await window.api.invoke<{ ok: boolean; error?: string }>(
      "crawler:test-connection"
    );
    if (res.ok) {
      setStatus({ kind: "ok", msg: "연결 성공" });
      onSaved();
    } else {
      setStatus({
        kind: "error",
        msg: `연결 실패: ${res.error ?? "unknown"}`,
      });
    }
  };

  const onTestWebhook = async () => {
    if (!chatWebhookUrl) {
      setStatus({ kind: "error", msg: "webhook URL을 먼저 입력하세요." });
      return;
    }
    setStatus({ kind: "testing", msg: "webhook 전송 중..." });
    try {
      const res = await window.api.invoke<{
        ok: boolean;
        status?: number;
        error?: string;
      }>("notifier:test", { webhookUrl: chatWebhookUrl });
      if (res.ok) {
        setStatus({
          kind: "ok",
          msg: `webhook 테스트 성공 (HTTP ${res.status}). Google Chat 확인하세요.`,
        });
      } else {
        setStatus({
          kind: "error",
          msg: `webhook 실패: ${res.error ?? "unknown"}`,
        });
      }
    } catch (e) {
      setStatus({
        kind: "error",
        msg: `webhook 예외: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  };

  const disabled = !url || !anonKey || !table;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">환경설정</h2>
        <p className="mt-1 text-sm text-slate-400">
          Supabase 자격증명은 OS별 보안 저장소(macOS Keychain / Windows DPAPI
          / Linux libsecret)에 암호화되어 저장됩니다.
        </p>
        {!encryptionAvailable && (
          <p className="mt-2 rounded bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            ⚠️ 이 환경에서는 OS 보안 저장소가 비활성화되어 자격증명이 평문으로
            저장됩니다. (Linux에서 libsecret 미설치 시 발생)
          </p>
        )}
      </div>

      <Field label="SUPABASE_URL" required>
        <input
          className="input"
          placeholder="https://xxxxx.supabase.co"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </Field>

      <Field label="SUPABASE_ANON_KEY" required>
        <input
          className="input"
          type="password"
          placeholder="eyJ..."
          value={anonKey}
          onChange={(e) => setAnonKey(e.target.value)}
        />
      </Field>

      <Field label="SUPABASE_TABLE (테이블명)" required>
        <input
          className="input"
          placeholder="places"
          value={table}
          onChange={(e) => setTable(e.target.value)}
        />
      </Field>

      <details
        open={showAdvanced}
        onToggle={(e) =>
          setShowAdvanced((e.target as HTMLDetailsElement).open)
        }
        className="rounded border border-slate-800 bg-slate-900/40 px-4 py-3"
      >
        <summary className="cursor-pointer text-sm font-medium text-slate-300">
          고급 설정 — Service Role Key (선택)
        </summary>
        <div className="mt-3">
          <p className="text-xs text-slate-500">
            Service Role Key가 있으면 테이블이 없을 때 앱이 자동으로 생성을
            시도합니다. (프로젝트에 <code>exec_sql</code> RPC가 정의되어 있어야
            동작 — 없으면 SQL을 보여드립니다.)
          </p>
          <input
            className="input mt-2"
            type="password"
            placeholder={
              hasServiceKey ? "(저장됨 — 새 값 입력 시 덮어씀)" : "eyJ..."
            }
            value={serviceKey}
            onChange={(e) => setServiceKey(e.target.value)}
          />
        </div>
      </details>

      <details
        className="rounded border border-slate-800 bg-slate-900/40 px-4 py-3"
      >
        <summary className="cursor-pointer text-sm font-medium text-slate-300">
          알림 — Google Chat Webhook (선택){" "}
          {hasChatWebhook && (
            <span className="ml-2 text-xs text-emerald-400">● 저장됨</span>
          )}
        </summary>
        <div className="mt-3 space-y-2">
          <p className="text-xs text-slate-500">
            크롤링 중 저장 10회 연속 실패(자동종료), 차단 의심, 구조 변화 의심,
            세션 비정상 종료, 정상 완료 시 Google Chat 으로 알림이 갑니다.
            <br />
            URL 형식:{" "}
            <code className="text-slate-400">
              https://chat.googleapis.com/v1/spaces/.../messages?key=...&token=...
            </code>
          </p>
          <input
            className="input"
            type="password"
            placeholder={
              hasChatWebhook
                ? "(저장됨 — 새 값 입력 시 덮어씀)"
                : "https://chat.googleapis.com/v1/spaces/..."
            }
            value={chatWebhookUrl}
            onChange={(e) => setChatWebhookUrl(e.target.value)}
          />
          <div>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={onTestWebhook}
              disabled={!chatWebhookUrl}
            >
              📤 테스트 메시지 전송
            </button>
          </div>
        </div>
      </details>

      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={disabled} onClick={onSave}>
          저장
        </button>
        <button className="btn-secondary" disabled={disabled} onClick={onTest}>
          연결 테스트
        </button>
        <button
          className="btn-ghost"
          onClick={() => navigate("/start")}
          disabled={disabled}
        >
          크롤링으로 →
        </button>
      </div>

      {status.kind === "ok" && (
        <p className="text-sm text-emerald-400">✓ {status.msg}</p>
      )}
      {status.kind === "error" && (
        <p className="text-sm text-rose-400">✗ {status.msg}</p>
      )}
      {(status.kind === "saving" || status.kind === "testing") && (
        <p className="text-sm text-slate-400">
          {status.kind === "saving" ? "저장 중..." : "연결 확인 중..."}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">
        {label} {required && <span className="text-rose-400">*</span>}
      </span>
      {children}
    </label>
  );
}
