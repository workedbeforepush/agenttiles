// Shared helpers for macOS and Linux: the process table via `ps`, and the PATH of the user's login shell.
import { execFile, execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
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

/** Parses `ps -o lstart= -p <pid>`, e.g. "Wed Oct 22 08:03:12 2026"; null when ps printed nothing. */
export function parseLstart(output: string): string | null {
  const start = output.trim();
  return start.length > 0 ? start : null;
}

/**
 * Start time of a running process in the format of procStart in the registry, or null when the process does not
 * exist. Claude Code takes procStart from `ps -o lstart=` in the C locale and UTC, so this runs the same command.
 */
export function processStartTime(pid: number): string | null {
  try {
    const output = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
    });
    return parseLstart(output);
  } catch {
    // ps exits 1 for a pid that does not exist.
    return null;
  }
}

/** True when `name` is a file on PATH; a directory of that name (e.g. a checkout called "kitty") does not count. */
export function onPath(name: string): boolean {
  return (process.env['PATH'] ?? '')
    .split(delimiter)
    .some((dir) => dir && statSync(join(dir, name), { throwIfNoEntry: false })?.isFile() === true);
}

const MARK = '__AGENTTILES_PATH__';

/**
 * Prints PATH between markers in every login shell people use: `${PATH}` is a syntax error in fish, and fish joins
 * a quoted "$PATH" list with spaces in older versions. `printenv` prints the exported value, colon-separated.
 */
export const SHELL_PATH_COMMAND = `echo ${MARK}; printenv PATH; echo ${MARK}`;

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
    const output = await run(shell, ['-ilc', SHELL_PATH_COMMAND], 10_000);
    const path = parseShellPath(output);
    if (path) process.env['PATH'] = mergePath(process.env['PATH'] ?? '', path);
  } catch {
    // Keep the inherited PATH; the doctor shows when node or claude are missing.
  }
}
