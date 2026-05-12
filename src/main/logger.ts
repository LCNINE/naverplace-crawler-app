import { pino, Logger as PinoLogger } from "pino";
import type { BrowserWindow } from "electron";
import type { LogEvent } from "./types.js";

let mainWindow: BrowserWindow | null = null;

export function setLogTarget(window: BrowserWindow | null) {
  mainWindow = window;
}

function broadcast(event: LogEvent) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("crawler:log", event);
}

const ringSize = 1000;
const ring: LogEvent[] = [];

function push(event: LogEvent) {
  ring.push(event);
  if (ring.length > ringSize) ring.shift();
  broadcast(event);
}

export function recentLogs(): LogEvent[] {
  return ring.slice();
}

export function clearLogs(): void {
  ring.length = 0;
}

const baseLogger = pino({
  level: "debug",
  base: undefined,
  timestamp: pino.stdTimeFunctions.epochTime,
});

function adapt(level: LogEvent["level"]) {
  return (firstArg: unknown, msg?: string) => {
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
    const event: LogEvent = {
      level,
      msg: message,
      time: Date.now(),
      ctx,
    };
    push(event);
    (baseLogger[level] as (a: unknown, b?: string) => void)(
      ctx ?? {},
      message
    );
  };
}

export interface Logger {
  trace: (a: unknown, b?: string) => void;
  debug: (a: unknown, b?: string) => void;
  info: (a: unknown, b?: string) => void;
  warn: (a: unknown, b?: string) => void;
  error: (a: unknown, b?: string) => void;
  fatal: (a: unknown, b?: string) => void;
}

export function createLogger(): Logger {
  return {
    trace: adapt("trace"),
    debug: adapt("debug"),
    info: adapt("info"),
    warn: adapt("warn"),
    error: adapt("error"),
    fatal: adapt("fatal"),
  };
}

export type { PinoLogger };
