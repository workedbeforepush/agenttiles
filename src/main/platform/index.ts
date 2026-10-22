// Platform dispatch: Windows (Win32 + Windows Terminal), macOS (Terminal.app / iTerm2) and Linux (X11 + xdotool).
import type { TerminalTarget } from '../../core/types';
import { log } from '../log';

type WindowsModule = typeof import('./windows');
type MacModule = typeof import('./mac');
type LinuxModule = typeof import('./linux');
type UnixModule = typeof import('./unix');

let win: WindowsModule | null = null;
let mac: MacModule | null = null;
let linux: LinuxModule | null = null;
let unix: UnixModule | null = null;
/** One UI Automation tab switch at a time; repeated clicks must not pile up PowerShell processes. */
let selectingTab = false;
/** Where `openTerminal` opens sessions; follows the setting. */
let terminalTarget: TerminalTarget = 'tab';

export function setTerminalTarget(target: TerminalTarget): void {
  terminalTarget = target;
}

export async function initPlatform(): Promise<void> {
  if (process.platform === 'win32') {
    win = await import('./windows');
    win.prepareTabSelection();
    return;
  }
  // Before anything looks for node or claude: apps started from Finder or a launcher lack the shell's PATH.
  unix = await import('./unix');
  await unix.adoptLoginShellPath();
  if (process.platform === 'darwin') mac = await import('./mac');
  else if (process.platform === 'linux') linux = await import('./linux');
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * macOS and Linux: whether a pid's start time matched the registry's procStart, per pid while it lives. Running `ps`
 * for every session on every poll would block the main process; a pid keeps its start time until it exits.
 */
const startMatches = new Map<number, { procStart: string; match: boolean }>();

/**
 * True when the process exists and its start time matches the registry's procStart, which guards against PID reuse
 * after a crash left a stale registry file behind. Without procStart only the process has to exist.
 */
export function isAlive(pid: number, procStart: string | null): boolean {
  if (win) {
    const started = win.processStartTime(pid);
    if (started === null) return false;
    return procStart === null || started === procStart;
  }
  if (!pidExists(pid)) {
    startMatches.delete(pid);
    return false;
  }
  if (procStart === null || !unix) return true;
  const known = startMatches.get(pid);
  if (known?.procStart === procStart) return known.match;
  const started = unix.processStartTime(pid);
  // Not remembered: the process exited meanwhile or ps failed; the next poll asks again.
  if (started === null) return false;
  const match = started === procStart;
  startMatches.set(pid, { procStart, match });
  return match;
}

/** PIDs of all running claude processes, or null where the process table is not supported. */
export async function claudeProcesses(): Promise<number[] | null> {
  if (win) return win.claudeProcessIds();
  if (mac || linux) return (await import('./unix')).claudeProcessIds().catch(() => null);
  return null;
}

/** Starts AgentTiles with the user session (Linux; Windows and macOS use Electron's login items). */
export function setLinuxAutostart(enabled: boolean, exec: string[]): void {
  linux?.setAutostart(enabled, exec);
}

/** Windows: registers the toast sender identity (name and icon) for the app id. */
export function registerAppIdentity(appId: string, displayName: string, iconPath: string): void {
  if (!win) return;
  try {
    win.registerAppId(appId, displayName, iconPath);
  } catch (error) {
    log.warn(`app id registration failed: ${(error as Error).message}`);
  }
}

/**
 * Opens a terminal running a command in `cwd`: a Windows Terminal or iTerm2 tab or window (the setting), a
 * Terminal.app window, or a window of the first installed Linux terminal.
 */
export async function openTerminal(cwd: string, command: string[], env: NodeJS.ProcessEnv): Promise<'opened' | 'failed' | 'unsupported'> {
  let opened: boolean;
  if (win) opened = await win.openTerminalTab(cwd, command, env, terminalTarget);
  else if (mac) opened = await mac.openTerminalTab(cwd, command, terminalTarget);
  else if (linux) opened = await linux.openTerminalTab(cwd, command, env);
  else return 'unsupported';
  return opened ? 'opened' : 'failed';
}

/** 'noX11' / 'noXdotool': Linux focus needs an X11 display and xdotool. */
export type FocusResult = 'focused' | 'minimized' | 'notFound' | 'unsupported' | 'noX11' | 'noXdotool';

/** The session and window AgentTiles brought to front last; a second click on that tile sends the window away again. */
let lastFocus: { sessionId: string; hwnd: string } | null = null;

/** The titles a tab or window can be matched by: an empty one ends and is contained in every name. */
export function matchableTitles(titles: string[]): string[] {
  return titles.filter((title) => title.trim().length > 0);
}

/**
 * Toggles the window hosting a Claude Code session: brings it to front (selecting the Windows Terminal tab), or
 * minimizes it when AgentTiles showed exactly this session last and the window is still frontmost on its monitor.
 */
export async function focusSession(sessionId: string, pid: number, sessionTitles: string[]): Promise<FocusResult> {
  const titles = matchableTitles(sessionTitles);
  if (mac) return mac.focusSession(pid);
  if (linux) return linux.focusSession(pid, titles);
  if (!win) return 'unsupported';
  const host = win.findHostWindows(pid);
  if (!host) return 'notFound';
  const first = host.hwnds[0];
  if (!first) return 'notFound';

  if (lastFocus?.sessionId === sessionId) {
    const shown = host.hwnds.find((h) => win?.hwndValue(h) === lastFocus?.hwnd);
    const frontmost = shown ? win.isFrontmost(shown, process.pid) : false;
    log.debug(`toggle ${sessionId}: window ${lastFocus.hwnd} found=${shown !== undefined} frontmost=${frontmost}`);
    if (shown && frontmost) {
      win.minimize(shown);
      lastFocus = null;
      return 'minimized';
    }
  }

  const terminal = host.exe.toLowerCase() === 'windowsterminal.exe' && titles.length > 0;
  if (!terminal || selectingTab) {
    win.bringToFront(first);
    lastFocus = { sessionId, hwnd: win.hwndValue(first) };
    return 'focused';
  }
  // One Windows Terminal process can own several windows: the matching tab decides which window comes to front.
  // With a single window, show it right away and switch the tab afterwards.
  if (host.hwnds.length === 1) win.bringToFront(first);
  selectingTab = true;
  try {
    const hwnd = await win.selectTerminalTab(host.hwnds, titles);
    if (!hwnd) log.debug(`no Windows Terminal tab matched ${JSON.stringify(titles)}`);
    if (host.hwnds.length > 1) win.bringToFront(hwnd ?? first);
    lastFocus = { sessionId, hwnd: win.hwndValue(hwnd ?? first) };
  } finally {
    selectingTab = false;
  }
  log.debug(`focused ${host.exe} for pid ${pid}`);
  return 'focused';
}
