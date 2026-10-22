// macOS: jump to the session's tab in Terminal.app or iTerm2 (AppleScript), bring other host apps to the front,
// and open new sessions in iTerm2 (when it runs) or Terminal.app.
import { existsSync } from 'node:fs';
import type { TerminalTarget } from '../../core/types';
import { ancestors, processTable, run, ttyOf, type UnixProcess } from './unix';

export type MacTerminal = 'Terminal' | 'iTerm2';

/** The app bundle a process belongs to, e.g. "/Applications/iTerm.app", or null. */
export function appBundleOf(comm: string): string | null {
  const match = /^(.*?\.app)\//.exec(comm);
  return match ? match[1]! : null;
}

/** The nearest ancestor that is part of an app bundle: the terminal or IDE hosting the session. */
export function hostApp(chain: UnixProcess[]): string | null {
  for (const entry of chain) {
    const bundle = appBundleOf(entry.comm);
    if (bundle) return bundle;
  }
  return null;
}

export function terminalOf(bundle: string): MacTerminal | null {
  if (/\/Terminal\.app$/.test(bundle)) return 'Terminal';
  if (/\/iTerm2?\.app$/.test(bundle)) return 'iTerm2';
  return null;
}

/** An AppleScript string literal. */
export function appleString(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** A shell word in single quotes. */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** AppleScript that selects the tab with the given tty and brings its window to the front; prints "ok" or "none". */
export function selectTabScript(terminal: MacTerminal, tty: string): string {
  if (terminal === 'Terminal') {
    return [
      'tell application "Terminal"',
      '  repeat with w in windows',
      '    repeat with t in tabs of w',
      `      if tty of t is ${appleString(tty)} then`,
      '        set selected of t to true',
      '        set index of w to 1',
      '        activate',
      '        return "ok"',
      '      end if',
      '    end repeat',
      '  end repeat',
      'end tell',
      'return "none"',
    ].join('\n');
  }
  return [
    'tell application "iTerm2"',
    '  repeat with w in windows',
    '    repeat with t in tabs of w',
    '      repeat with s in sessions of t',
    `        if tty of s is ${appleString(tty)} then`,
    '          select w',
    '          select t',
    '          select s',
    '          activate',
    '          return "ok"',
    '        end if',
    '      end repeat',
    '    end repeat',
    '  end repeat',
    'end tell',
    'return "none"',
  ].join('\n');
}

/**
 * AppleScript that runs `command` in `cwd`: iTerm2 opens a tab in its current window or a new window; Terminal.app's
 * `do script` always opens a window (a tab there would need keystrokes through System Events).
 */
export function openScript(terminal: MacTerminal, cwd: string, command: string[], target: TerminalTarget): string {
  const line = appleString(`cd ${shellQuote(cwd)} && ${command.map(shellQuote).join(' ')}`);
  if (terminal === 'Terminal') {
    return ['tell application "Terminal"', '  activate', `  do script ${line}`, 'end tell'].join('\n');
  }
  return [
    'tell application "iTerm2"',
    '  activate',
    `  if ${target === 'window' ? 'true' : '(count of windows) is 0'} then`,
    '    set w to (create window with default profile)',
    '  else',
    '    set w to current window',
    '    tell w to create tab with default profile',
    '  end if',
    `  tell current session of w to write text ${line}`,
    'end tell',
  ].join('\n');
}

export type MacFocus = 'focused' | 'notFound';

/**
 * Brings the session's terminal to the front. Terminal.app and iTerm2 switch to the exact tab (the first time,
 * macOS asks the user to allow AgentTiles to control the terminal); other hosts (VS Code, JetBrains, Ghostty, ...) are
 * brought to the front as an app.
 */
export async function focusSession(pid: number): Promise<MacFocus> {
  const chain = ancestors(pid, await processTable());
  const bundle = hostApp(chain);
  if (!bundle) return 'notFound';
  const terminal = terminalOf(bundle);
  const tty = terminal ? await ttyOf(pid) : null;
  if (terminal && tty && /^\/dev\/ttys\d+$/.test(tty)) {
    const result = await run('osascript', ['-e', selectTabScript(terminal, tty)]).catch(() => 'none');
    if (result.trim() === 'ok') return 'focused';
  }
  await run('open', ['-a', bundle]);
  return 'focused';
}

/** iTerm2 when it is running or installed, Terminal.app otherwise. */
async function preferredTerminal(): Promise<MacTerminal> {
  const running = await run('pgrep', ['-x', 'iTerm2']).then(() => true).catch(() => false);
  return running || existsSync('/Applications/iTerm.app') ? 'iTerm2' : 'Terminal';
}

export async function openTerminalTab(cwd: string, command: string[], target: TerminalTarget): Promise<boolean> {
  try {
    await run('osascript', ['-e', openScript(await preferredTerminal(), cwd, command, target)], 15_000);
    return true;
  } catch {
    return false;
  }
}
