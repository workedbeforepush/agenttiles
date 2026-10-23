// macOS: jump to the session's tab in Terminal.app, iTerm2 (AppleScript), WezTerm, kitty or tmux, bring the project
// window of other host apps to the front (System Events), and open new sessions in iTerm2 (when it runs) or
// Terminal.app.
import { existsSync } from 'node:fs';
import type { TerminalTarget } from '../../core/types';
import { pickWindow, projectNames } from './project';
import { ancestors, processTable, run, selectTerminalPane, sessionTerminal, type UnixProcess } from './unix';

export type MacTerminal = 'Terminal' | 'iTerm2';

/** The app bundle a process belongs to, e.g. "/Applications/iTerm.app", or null. */
export function appBundleOf(comm: string): string | null {
  const match = /^(.*?\.app)\//.exec(comm);
  return match ? match[1]! : null;
}

/** The nearest ancestor that is part of an app bundle: the terminal or IDE hosting the session. */
export function hostProcess(chain: UnixProcess[]): UnixProcess | null {
  return chain.find((entry) => appBundleOf(entry.comm) !== null) ?? null;
}

/** The bundle of `hostProcess`, e.g. "/Applications/iTerm.app". */
export function hostApp(chain: UnixProcess[]): string | null {
  const host = hostProcess(chain);
  return host ? appBundleOf(host.comm) : null;
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
  // The line is typed into an interactive shell, whose line editor acts on control characters even inside quotes.
  if (/[\x00-\x1f\x7f]/.test([cwd, ...command].join(''))) throw new Error(`control character in ${JSON.stringify(cwd)}`);
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
 * AppleScript that prints the titles of an app process's windows, front to back, one per line (an untitled window
 * prints an empty line). System Events reads other apps' windows only with Accessibility access for AgentTiles.
 */
export function windowTitlesScript(pid: number): string {
  return [
    'tell application "System Events"',
    `  set p to first application process whose unix id is ${pid}`,
    '  set out to ""',
    '  repeat with w in windows of p',
    '    set n to name of w',
    '    if n is missing value then set n to ""',
    '    set out to out & n & linefeed',
    '  end repeat',
    '  return out',
    'end tell',
  ].join('\n');
}

/** The window titles printed by `windowTitlesScript`: osascript adds a line break after the script's last one. */
export function parseWindowTitles(output: string): string[] {
  return output.replace(/\n$/, '').split('\n').slice(0, -1);
}

/** AppleScript that raises the app process's window with the given title and brings the app to the front. */
export function raiseWindowScript(pid: number, title: string): string {
  return [
    'tell application "System Events"',
    `  set p to first application process whose unix id is ${pid}`,
    `  perform action "AXRaise" of (first window of p whose name is ${appleString(title)})`,
    '  set frontmost of p to true',
    'end tell',
  ].join('\n');
}

/**
 * Raises the window of an app process that names the session or its project; false when the app has fewer than two
 * windows or none matches, and when System Events cannot see the windows (no Accessibility access).
 */
async function raiseProjectWindow(pid: number, titles: string[], cwd: string): Promise<boolean> {
  const windows = parseWindowTitles(await run('osascript', ['-e', windowTitlesScript(pid)]));
  if (windows.length < 2) return false;
  const index = pickWindow(windows, titles, projectNames(cwd));
  if (index === null) return false;
  await run('osascript', ['-e', raiseWindowScript(pid, windows[index]!)]);
  return true;
}

/**
 * Brings the session's terminal to the front. A session in tmux is first shown in the tmux client used last, whose
 * terminal is then the one to bring up. Terminal.app and iTerm2 switch to the exact tab (the first time, macOS asks
 * the user to allow AgentTiles to control the terminal), WezTerm and kitty to the exact pane; for other hosts (VS
 * Code, JetBrains, Ghostty, ...) the window naming the session or its project comes up (with Accessibility access),
 * otherwise the app as a whole.
 */
export async function focusSession(pid: number, titles: string[], cwd: string): Promise<MacFocus> {
  const target = await sessionTerminal(pid);
  const chain = ancestors(target.pid, await processTable());
  const host = hostProcess(chain);
  const bundle = host ? appBundleOf(host.comm) : null;
  if (!host || !bundle) return 'notFound';
  await selectTerminalPane(target, chain).catch(() => undefined);
  const terminal = terminalOf(bundle);
  if (terminal && target.tty && /^\/dev\/ttys\d+$/.test(target.tty)) {
    const result = await run('osascript', ['-e', selectTabScript(terminal, target.tty)]).catch(() => 'none');
    if (result.trim() === 'ok') return 'focused';
  }
  const raised = await raiseProjectWindow(host.pid, titles, cwd).catch(() => false);
  if (!raised) await run('open', ['-a', bundle]);
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
