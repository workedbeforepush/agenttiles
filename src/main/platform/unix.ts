// Shared helpers for macOS and Linux: the process table via `ps`, the PATH of the user's login shell, and pane
// selection in tmux, WezTerm and kitty.
import { execFile, execFileSync } from 'node:child_process';
import { readFileSync, readlinkSync, statSync } from 'node:fs';
import { basename, delimiter, join } from 'node:path';
import { environmentValue, kittyFocusArgs } from './kitty';
import { TMUX_CLIENTS_ARGS, TMUX_PANES_ARGS, parseTmuxClients, parseTmuxPanes, pickTmuxClient, tmuxSwitchArgs } from './tmux';
import { WEZTERM_LIST_ARGS, findWezTermPane, parseWezTermPanes, siblingExecutable, weztermActivateArgs } from './wezterm';

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

// ---- tabs and panes -----------------------------------------------------------------------------------

/** A process shown in a terminal tab or pane, with its controlling terminal. */
export interface TerminalProcess {
  pid: number;
  tty: string | null;
}

/**
 * tmux: when `tty` is a tmux pane, shows that pane in the most recently used client and returns the client, whose
 * terminal then hosts the session. Null when the tty is no pane of the default tmux server or no client is attached.
 */
async function showTmuxPane(tty: string): Promise<TerminalProcess | null> {
  if (!onPath('tmux')) return null;
  // Fails when no tmux server runs.
  const pane = parseTmuxPanes(await run('tmux', TMUX_PANES_ARGS).catch(() => '')).find((p) => p.tty === tty);
  if (!pane) return null;
  const client = pickTmuxClient(parseTmuxClients(await run('tmux', TMUX_CLIENTS_ARGS)), pane);
  if (!client) return null;
  await run('tmux', tmuxSwitchArgs(client, pane));
  return { pid: client.pid, tty: client.tty };
}

/** The process whose terminal shows the session: a tmux client switched to the session's pane, or the session. */
export async function sessionTerminal(pid: number): Promise<TerminalProcess> {
  const tty = await ttyOf(pid).catch(() => null);
  const client = tty ? await showTmuxPane(tty).catch(() => null) : null;
  return client ?? { pid, tty };
}

/** The program file of a process: macOS `comm` is the full path, Linux `comm` only the name. */
function executableOf(proc: UnixProcess): string {
  return process.platform === 'linux' ? readlinkSync(`/proc/${proc.pid}/exe`) : proc.comm;
}

async function environmentOf(pid: number): Promise<string> {
  if (process.platform === 'linux') return readFileSync(`/proc/${pid}/environ`, 'utf8');
  return run('ps', ['-E', '-ww', '-o', 'command=', '-p', String(pid)]);
}

async function selectWezTermPane(gui: UnixProcess, tty: string): Promise<void> {
  const cli = siblingExecutable(executableOf(gui), 'wezterm');
  const pane = findWezTermPane(parseWezTermPanes(await run(cli, WEZTERM_LIST_ARGS)), tty, []);
  if (pane) await run(cli, weztermActivateArgs(pane.paneId));
}

/**
 * kitty answers only with remote control on a socket (`allow_remote_control` and `listen_on` in kitty.conf), whose
 * address it hands its windows in KITTY_LISTEN_ON. Without it the window only comes to the front.
 */
async function focusKittyWindow(kitty: UnixProcess, child: UnixProcess): Promise<void> {
  const address = environmentValue(await environmentOf(child.pid), 'KITTY_LISTEN_ON');
  if (!address) return;
  await run(siblingExecutable(executableOf(kitty), 'kitty'), kittyFocusArgs(address, child.pid));
}

/**
 * Selects the tab and pane of `target` when WezTerm or kitty hosts it (`chain`: its ancestors, nearest first).
 * Raising the terminal window is the caller's job.
 */
export async function selectTerminalPane(target: TerminalProcess, chain: UnixProcess[]): Promise<void> {
  for (const [index, proc] of chain.entries()) {
    const name = basename(proc.comm);
    if (name === 'wezterm-gui') {
      if (target.tty) await selectWezTermPane(proc, target.tty);
      return;
    }
    const child = chain[index - 1];
    if (name === 'kitty' && child) {
      await focusKittyWindow(proc, child);
      return;
    }
  }
}
