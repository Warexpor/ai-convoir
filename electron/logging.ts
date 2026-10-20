import fs from "node:fs";
import path from "node:path";

type Level = "trace" | "debug" | "info" | "warn" | "error";
const RANK: Record<Level, number> = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };

let logFile: string | null = null;
const minLevel: Level = (process.env.CONVOIR_LOG as Level) in RANK ? (process.env.CONVOIR_LOG as Level) : "info";

export function initLogging(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  logFile = path.join(dir, "ai-convoir.log");
  return logFile;
}

export function logPath(): string | null {
  return logFile;
}

function write(level: Level, target: string, message: string) {
  if (RANK[level] < RANK[minLevel]) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padStart(5)} ${target}: ${message}`;
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(`${line}\n`);
  if (logFile) {
    try {
      fs.appendFileSync(logFile, `${line}\n`);
    } catch {
      /* disk full / permissions: stderr still has it */
    }
  }
}

export const logger = {
  trace: (t: string, m: string) => write("trace", t, m),
  debug: (t: string, m: string) => write("debug", t, m),
  info: (t: string, m: string) => write("info", t, m),
  warn: (t: string, m: string) => write("warn", t, m),
  error: (t: string, m: string) => write("error", t, m),
};

export function writeFrontend(level: string, message: string, source?: string | null) {
  const l = level.toLowerCase();
  const lvl: Level = l === "warning" ? "warn" : l in RANK ? (l as Level) : "info";
  write(lvl, "frontend", `${source || "ui"}: ${message}`);
}
