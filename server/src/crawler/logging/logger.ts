export interface Logger {
  trace: (a: unknown, b?: string) => void;
  debug: (a: unknown, b?: string) => void;
  info: (a: unknown, b?: string) => void;
  warn: (a: unknown, b?: string) => void;
  error: (a: unknown, b?: string) => void;
  fatal: (a: unknown, b?: string) => void;
}
