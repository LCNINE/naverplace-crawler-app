import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
import { loadChatWebhookUrl } from "./secrets.js";

export type NotificationSeverity = "critical" | "warning" | "info";

/**
 * 카테고리 — 동일 카테고리의 알림은 cooldown 기간 동안 1회만 전송된다.
 * 새 카테고리 추가 시 여기에 등록하고 cooldown 도 결정.
 */
export type NotificationCategory =
  | "save_failures"
  | "empty_dongs"
  | "iframe_missing"
  | "session_fatal"
  | "session_completed"
  | "test";

const COOLDOWN_MS: Record<NotificationCategory, number> = {
  save_failures: 5 * 60 * 1000, // 5분
  empty_dongs: 30 * 60 * 1000, // 30분 (느슨)
  iframe_missing: 30 * 60 * 1000,
  session_fatal: 60 * 1000, // 1분 (재시작 직후 다시 깨지는 케이스 빠르게 감지)
  session_completed: 0, // 완료는 매번 보냄
  test: 0, // 테스트는 쿨다운 없음
};

interface NotifyArgs {
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  /** key-value context. 메시지에 줄단위로 렌더 */
  context?: Record<string, string | number | undefined | null>;
}

interface PostResult {
  ok: boolean;
  status?: number;
  error?: string;
  skipped?: "cooldown" | "no_webhook";
}

/** 마지막 전송 시각 (카테고리별) */
const lastSentAt = new Map<NotificationCategory, number>();

const SEVERITY_ICON: Record<NotificationSeverity, string> = {
  critical: "🛑",
  warning: "⚠️",
  info: "ℹ️",
};

function formatBody(args: NotifyArgs): string {
  const icon = SEVERITY_ICON[args.severity];
  const lines: string[] = [`${icon} ${args.title}`];
  if (args.context) {
    for (const [k, v] of Object.entries(args.context)) {
      if (v == null || v === "") continue;
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push(`시간: ${new Date().toLocaleString("ko-KR")}`);
  return lines.join("\n");
}

function postToWebhook(webhookUrl: string, text: string): Promise<PostResult> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(webhookUrl);
    } catch (e) {
      resolve({
        ok: false,
        error: `invalid webhook URL: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }

    const body = JSON.stringify({ text });
    const req = httpsRequest(
      {
        method: "POST",
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "content-length": Buffer.byteLength(body),
        },
        timeout: 10_000,
      },
      (res) => {
        // body 는 굳이 읽지 않고 status 만 본다
        res.resume();
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) {
          resolve({ ok: true, status });
        } else {
          resolve({ ok: false, status, error: `HTTP ${status}` });
        }
      }
    );
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.on("timeout", () => {
      req.destroy(new Error("webhook request timeout"));
    });
    req.write(body);
    req.end();
  });
}

/**
 * Google Chat 으로 알림 전송. webhook URL 미설정/cooldown 중이면 조용히 skip.
 * 절대 throw 하지 않음 — caller (크롤러) 의 메인 흐름을 막지 않는다.
 */
export async function notifyChat(args: NotifyArgs): Promise<PostResult> {
  // cooldown 체크
  const cooldown = COOLDOWN_MS[args.category];
  const now = Date.now();
  const last = lastSentAt.get(args.category) ?? 0;
  if (cooldown > 0 && now - last < cooldown) {
    return { ok: false, skipped: "cooldown" };
  }

  const webhookUrl = await loadChatWebhookUrl().catch(() => undefined);
  if (!webhookUrl) {
    return { ok: false, skipped: "no_webhook" };
  }

  const text = formatBody(args);
  const result = await postToWebhook(webhookUrl, text);
  if (result.ok) {
    lastSentAt.set(args.category, now);
  }
  return result;
}

/** "테스트 메시지 보내기" — webhook URL 인자로 직접 받음 (저장 전 검증용) */
export async function sendTestMessage(
  webhookUrl: string
): Promise<PostResult> {
  if (!webhookUrl) return { ok: false, error: "webhook URL 없음" };
  const text = formatBody({
    category: "test",
    severity: "info",
    title: "✅ 크롤러 알림 연결 테스트",
    context: {
      "메시지": "이 채팅이 보이면 webhook 설정 정상입니다.",
    },
  });
  return await postToWebhook(webhookUrl, text);
}
