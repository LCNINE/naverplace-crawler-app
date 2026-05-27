import { pino } from "pino";
import type { Logger } from "./crawler/logging/logger.js";

const isDev = process.env.NODE_ENV !== "production";

const baseLogger = pino({
  level: "debug",
  base: undefined,
  timestamp: pino.stdTimeFunctions.epochTime,
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
        },
      }
    : {}),
});

export function createWorkerLogger(workerId: string): Logger {
  const child = baseLogger.child({ worker: workerId });

  function adapt(level: "trace" | "debug" | "info" | "warn" | "error" | "fatal") {
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
      (child[level] as (a: unknown, b?: string) => void)(ctx ?? {}, message);
    };
  }

  return {
    trace: adapt("trace"),
    debug: adapt("debug"),
    info: adapt("info"),
    warn: adapt("warn"),
    error: adapt("error"),
    fatal: adapt("fatal"),
  };
}
