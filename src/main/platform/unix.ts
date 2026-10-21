// Shared helpers for macOS and Linux: the process table via `ps`, and the PATH of the user's login shell.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export interface UnixProcess {
  pid: number;
  ppid: number;
  /** Full executable path (macOS `comm`) or the command name (Linux `comm`). */
  comm: string;
}

/** Parses `ps -axo pid=,ppid=,comm=`. The command may contain spaces (macOS app paths). */
export function parsePs(output: string): Map<number, UnixProcess> {
  const table = new Map<number, UnixProcess>();
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    table.set(pid, { pid, ppid: Number(match[2]), comm: match[3]! });
  }
  return table;
}

/** The process and its ancestors, nearest first (stops at pid 1 and on loops). */
export function ancestors(pid: number, table: Map<number, UnixProcess>): UnixProcess[] {
  const chain: UnixProcess[] = [];
  const seen = new Set<number>();
  for (let current = table.get(pid); current && !seen.has(current.pid); current = table.get(current.ppid)) {
    seen.add(current.pid);
    chain.push(current);
    if (current.ppid <= 1) break;
  }
  return chain;
}

export function run(file: string, args: string[], timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: timeoutMs }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

export async function processTable(): Promise<Map<number, UnixProcess>> {
  return parsePs(await run('ps', ['-axo', 'pid=,ppid=,comm=']));
}

export async function claudeProcessIds(): Promise<number[]> {
  const table = await processTable();
  return [...table.values()].filter((p) => /(^|\/)claude$/.test(p.comm)).map((p) => p.pid);
}

/** The controlling terminal of a process, e.g. "/dev/ttys003"; null without one. */
export async function ttyOf(pid: number): Promise<string | null> {
  const tty = (await run('ps', ['-o', 'tty=', '-p', String(pid)])).trim();
  if (!tty || tty === '??' || tty === '?') return null;
  return tty.startsWith('/dev/') ? tty : `/dev/${tty}`;
}

/** True when `name` is an executable on PATH. */
export function onPath(name: string): boolean {
  return (process.env['PATH'] ?? '').split(delimiter).some((dir) => dir && existsSync(join(dir, name)));
}

const MARK = '__CCDASH_PATH__';

/** The PATH printed between markers by a login shell; null when the output has none (shell startup noise is ignored). */
export function parseShellPath(output: string): string | null {
  const start = output.indexOf(MARK);
  const end = output.indexOf(MARK, start + MARK.length);
  if (start < 0 || end < 0) return null;
  const path = output.slice(start + MARK.length, end).trim();
  return path.length > 0 ? path : null;
}

/** `current` with the entries of `shell` added in front, without duplicates. */
export function mergePath(current: string, shell: string): string {
  const entries = [...shell.split(delimiter), ...current.split(delimiter)].filter((e) => e.length > 0);
  return [...new Set(entries)].join(delimiter);
}

/**
 * Apps started from Finder, the Dock or a desktop launcher do not get the PATH of the user's shell, so `node` and
 * `claude` (installed by nvm, Homebrew, npm or Claude's own installer) are not found. Takes the PATH from an
 * interactive login shell, like a terminal would.
 */
export async function adoptLoginShellPath(): Promise<void> {
  const shell = process.env['SHELL'] ?? '/bin/sh';
  try {
    const output = await run(shell, ['-ilc', `printf '%s' "${MARK}$PATH${MARK}"`], 10_000);
    const path = parseShellPath(output);
    if (path) process.env['PATH'] = mergePath(process.env['PATH'] ?? '', path);
  } catch {
    // Keep the inherited PATH; the doctor shows when node or claude are missing.
  }
}
