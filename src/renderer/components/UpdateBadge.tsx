import { useEffect, useState } from "react";

type UpdateStatus =
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "not-available"; version: string }
  | { type: "downloading"; percent: number; bytesPerSecond: number }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string };

export default function UpdateBadge() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [appVersion, setAppVersion] = useState<string>("");

  useEffect(() => {
    let off: (() => void) | undefined;
    (async () => {
      try {
        const v = await window.api.invoke<string>("updater:appVersion");
        setAppVersion(v);
        const initial = await window.api.invoke<UpdateStatus | null>(
          "updater:status"
        );
        if (initial) setStatus(initial);
      } catch {
        /* ignore */
      }
      off = window.api.on("updater:status", (payload) => {
        setStatus(payload as UpdateStatus);
      });
    })();
    return () => {
      off?.();
    };
  }, []);

  if (!status || status.type === "checking" || status.type === "not-available") {
    return appVersion ? (
      <span className="text-[10px] text-slate-500" title="현재 버전">
        v{appVersion}
      </span>
    ) : null;
  }

  if (status.type === "error") {
    return (
      <span
        className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-300"
        title={status.message}
      >
        업데이트 오류
      </span>
    );
  }

  if (status.type === "available") {
    return (
      <span
        className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300"
        title={`v${status.version} 다운로드 준비 중`}
      >
        업데이트 발견 v{status.version}
      </span>
    );
  }

  if (status.type === "downloading") {
    return (
      <span
        className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300"
        title={`초당 ${(status.bytesPerSecond / 1024).toFixed(0)} KB`}
      >
        업데이트 다운로드 {status.percent}%
      </span>
    );
  }

  // downloaded
  return (
    <button
      onClick={() => window.api.invoke("updater:quitAndInstall")}
      className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-500/30"
      title="클릭하면 재시작하여 업데이트 적용"
    >
      재시작하여 업데이트 v{status.version}
    </button>
  );
}
