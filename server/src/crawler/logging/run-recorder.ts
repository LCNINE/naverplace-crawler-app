import type { Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "./logger.js";

/**
 * 메모리버퍼 Logger.
 *
 * 동영님 조언: 페이지 이동마다 log/screenshot 을 메모리에만 모아두다가,
 * run 이 실패할 때만 전체를 파일로 dump → 원인 파악 루프를 빠르게.
 *
 * 기존 Logger(6메서드)를 "교체"하지 않고 "래핑"한다. asLogger() 가 같은
 * 인터페이스를 만족하므로 naver/* 호출부는 수정 불필요. 콘솔/실시간 출력은
 * consoleLevel(기본 info) 이상만 흘리고, 메모리 버퍼는 전 레벨 무손실 기록한다.
 *
 * run = 동(dong) 단위 → 메모리는 동 1개치만 유지(reset/finalize 로 경계).
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export interface RunLogEntry {
  /** run 시작 기준 경과 ms */
  t: number;
  level: LogLevel;
  msg: string;
  ctx?: unknown;
}

export interface RunScreenshot {
  t: number;
  label: string;
  bytes: Buffer;
}

export interface DumpResult {
  location: string;
}

export interface DumpSink {
  dump(
    runId: string,
    payload: {
      log: RunLogEntry[];
      screenshots: RunScreenshot[];
      reason: string;
    }
  ): Promise<DumpResult>;
}

/** 실패 run 의 로그+스크린샷을 로컬 파일로 남기는 기본 sink (노트북 운영). */
export class FileDumpSink implements DumpSink {
  constructor(private baseDir: string) {}

  async dump(
    runId: string,
    payload: { log: RunLogEntry[]; screenshots: RunScreenshot[]; reason: string }
  ): Promise<DumpResult> {
    const dir = join(this.baseDir, "run-dumps", runId);
    await mkdir(dir, { recursive: true });

    const header = JSON.stringify({
      runId,
      reason: payload.reason,
      dumpedAt: new Date().toISOString(),
    });
    const ndjson = payload.log.map((e) => JSON.stringify(e)).join("\n");
    await writeFile(join(dir, "log.ndjson"), `${header}\n${ndjson}\n`, "utf8");

    let n = 0;
    for (const s of payload.screenshots) {
      n += 1;
      const safe = s.label.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 40);
      await writeFile(
        join(dir, `shot-${String(n).padStart(2, "0")}-${safe}.jpg`),
        s.bytes
      );
    }
    return { location: dir };
  }
}

export interface RunRecorderOptions {
  runId: string;
  /** 실시간 출력용 기존 pino logger */
  base: Logger;
  /** 콘솔로 흘릴 최소 레벨 (기본 "info") */
  consoleLevel?: LogLevel;
  /** 메모리 ring 상한 (기본 5000) */
  maxEntries?: number;
  /** 스크린샷 상한 (기본 30) */
  maxScreenshots?: number;
  dumpSink: DumpSink;
}

export class RunRecorder {
  private runId: string;
  private readonly base: Logger;
  private readonly consoleLevel: number;
  private readonly maxEntries: number;
  private readonly maxScreenshots: number;
  private readonly dumpSink: DumpSink;
  private entries: RunLogEntry[] = [];
  private screenshots: RunScreenshot[] = [];
  private startedAt = Date.now();

  constructor(opts: RunRecorderOptions) {
    this.runId = opts.runId;
    this.base = opts.base;
    this.consoleLevel = LEVEL_ORDER[opts.consoleLevel ?? "info"];
    this.maxEntries = opts.maxEntries ?? 5000;
    this.maxScreenshots = opts.maxScreenshots ?? 30;
    this.dumpSink = opts.dumpSink;
  }

  /** 새 run(동) 시작 시 호출 — 메모리 초기화 */
  reset(runId: string): void {
    this.runId = runId;
    this.entries = [];
    this.screenshots = [];
    this.startedAt = Date.now();
  }

  private record(level: LogLevel, firstArg: unknown, msg?: string): void {
    // logger.ts adapt() 와 동일한 정규화
    let ctx: Record<string, unknown> | undefined;
    let message: string;
    if (typeof firstArg === "string") {
      message = firstArg;
    } else if (firstArg instanceof Error) {
      ctx = { error: firstArg.message, stack: firstArg.stack };
      message = msg ?? firstArg.message;
    } else if (firstArg && typeof firstArg === "object") {
      ctx = firstArg as Record<string, unknown>;
      message = msg ?? "";
    } else {
      message = String(firstArg ?? "");
    }

    this.entries.push({
      t: Date.now() - this.startedAt,
      level,
      msg: message,
      ...(ctx ? { ctx } : {}),
    });
    if (this.entries.length > this.maxEntries) this.entries.shift();

    // 실시간 출력은 consoleLevel 이상만
    if (LEVEL_ORDER[level] >= this.consoleLevel) {
      (this.base[level] as (a: unknown, b?: string) => void)(firstArg, msg);
    }
  }

  /** CrawlSession 에 주입할 Logger. 호출부 수정 없이 메모리 버퍼링이 붙는다. */
  asLogger(): Logger {
    return {
      trace: (a, b) => this.record("trace", a, b),
      debug: (a, b) => this.record("debug", a, b),
      info: (a, b) => this.record("info", a, b),
      warn: (a, b) => this.record("warn", a, b),
      error: (a, b) => this.record("error", a, b),
      fatal: (a, b) => this.record("fatal", a, b),
    };
  }

  /** 페이지 이동 경계 표시 (dump 가독성용) */
  marker(label: string): void {
    this.entries.push({
      t: Date.now() - this.startedAt,
      level: "info",
      msg: `--- ${label} ---`,
    });
  }

  /** 현재 페이지 스크린샷을 메모리에 보관. 실패는 무시(차단 페이지 등에서 캡처 실패 가능). */
  async screenshot(page: Page, label: string): Promise<void> {
    try {
      const bytes = await page.screenshot({
        type: "jpeg",
        quality: 50,
        fullPage: false,
      });
      this.screenshots.push({
        t: Date.now() - this.startedAt,
        label,
        bytes,
      });
      if (this.screenshots.length > this.maxScreenshots) {
        this.screenshots.shift();
      }
    } catch {
      // ignore
    }
  }

  /** run 성공 종료 — 메모리 버림(디스크에 아무것도 안 남김), 요약 한 줄만 */
  finalizeSuccess(summary?: Record<string, unknown>): void {
    this.base.info(
      { runId: this.runId, durationMs: Date.now() - this.startedAt, ...summary },
      "✅ run summary"
    );
    this.entries = [];
    this.screenshots = [];
  }

  /** run 실패 종료 — 전체 로그+스크린샷을 dump */
  async finalizeFailure(reason: string): Promise<DumpResult | null> {
    try {
      const result = await this.dumpSink.dump(this.runId, {
        log: this.entries,
        screenshots: this.screenshots,
        reason,
      });
      this.base.error(
        { runId: this.runId, dump: result.location, reason },
        "🧾 run dump 저장됨"
      );
      this.entries = [];
      this.screenshots = [];
      return result;
    } catch (e) {
      this.base.error(
        { err: e instanceof Error ? e.message : String(e) },
        "run dump 저장 실패"
      );
      return null;
    }
  }
}
