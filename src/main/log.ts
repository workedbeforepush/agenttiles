// Minimal file logger with size-based rotation (agenttiles.log -> agenttiles.1.log).
import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { LogLevel } from '../core/types';

const ROTATE_BYTES = 5 * 1024 * 1024;
const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

let file: string | null = null;
let level: LogLevel = 'info';

export function initLog(dir: string, initialLevel: LogLevel): void {
  file = join(dir, 'agenttiles.log');
  level = initialLevel;
}

export function setLogLevel(next: LogLevel): void {
  level = next;
}

function write(lvl: LogLevel, message: string): void {
  if (ORDER[lvl] > ORDER[level]) return;
  const line = `${new Date().toISOString()} ${lvl.toUpperCase()} ${message}\n`;
  if (process.env['ELECTRON_RENDERER_URL']) process.stdout.write(line);
  if (!file) return;
  try {
    if (existsSync(file) && statSync(file).size > ROTATE_BYTES) renameSync(file, file.replace(/\.log$/, '.1.log'));
    appendFileSync(file, line);
  } catch {
    // A broken log file must not take the app down.
  }
}

export const log = {
  error: (message: string, error?: unknown): void =>
    write('error', error ? `${message}: ${(error as Error).stack ?? String(error)}` : message),
  warn: (message: string): void => write('warn', message),
  info: (message: string): void => write('info', message),
  debug: (message: string): void => write('debug', message),
};
