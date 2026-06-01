import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
import { config } from "./config.js";

export type NotificationSeverity = "critical" | "warning" | "info";

export type NotificationCategory =
  | "save_failures"
  | "empty_dongs"
  | "iframe_missing"
  | "blocked_backoff"
  | "structure_broken"
  | "session_fatal"
  | "session_completed"
  | "session_restarted"
  | "test";

const COOLDOWN_MS: Record<NotificationCategory, number> = {
  save_failures: 5 * 60 * 1000,
  empty_dongs: 30 * 60 * 1000,
  iframe_missing: 30 * 60 * 1000,
  // 차단 백오프 진입/종료는 매번 사람이 인지해야 하므로 쿨다운 없음
  blocked_backoff: 0,
  structure_broken: 5 * 60 * 1000,
  session_fatal: 60 * 1000,
  session_completed: 0,
  session_restarted: 0,
  test: 0,
};

interface NotifyArgs {
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  context?: Record<string, string | number | undefined | null>;
}

interface PostResult {
  ok: boolean;
  status?: number;
  error?: string;
  skipped?: "cooldown" | "no_webhook";
}

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
      resolve({ ok: false, error: `invalid webhook URL: ${e instanceof Error ? e.message : String(e)}` });
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
        res.resume();
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) resolve({ ok: true, status });
        else resolve({ ok: false, status, error: `HTTP ${status}` });
      }
    );
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.on("timeout", () => req.destroy(new Error("webhook request timeout")));
    req.write(body);
    req.end();
  });
}

export async function notifyChat(args: NotifyArgs): Promise<PostResult> {
  const cooldown = COOLDOWN_MS[args.category];
  const now = Date.now();
  const last = lastSentAt.get(args.category) ?? 0;
  if (cooldown > 0 && now - last < cooldown) {
    return { ok: false, skipped: "cooldown" };
  }

  const webhookUrl = config.chatWebhookUrl;
  if (!webhookUrl) {
    return { ok: false, skipped: "no_webhook" };
  }

  const text = formatBody(args);
  const result = await postToWebhook(webhookUrl, text);
  if (result.ok) lastSentAt.set(args.category, now);
  return result;
}
