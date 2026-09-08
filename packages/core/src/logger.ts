import { pino, type Logger } from "pino";

export type { Logger };

export function createLogger(name: string, level = process.env.LOG_LEVEL ?? "info"): Logger {
  return pino({ name, level });
}
