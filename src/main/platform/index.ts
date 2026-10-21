// Platform dispatch. Windows is fully supported; macOS and Linux get liveness only.
import { log } from '../log';

type WindowsModule = typeof import('./windows');

let win: WindowsModule | null = null;
/** One UI Automation tab switch at a time; repeated clicks must not pile up PowerShell processes. */
let selectingTab = false;

export async function initPlatform(): Promise<void> {
  if (process.platform === 'win32') win = await import('./windows');
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
 * True when the process exists. On Windows the creation time must also match the registry's procStart,
 * which guards against PID reuse after a crash left a stale registry file behind.
 */
export function isAlive(pid: number, procStart: string | null): boolean {
  if (win) {
    const started = win.processStartTime(pid);
    if (started === null) return false;
    return procStart === null || started === procStart;
  }
  return pidExists(pid);
}

/** PIDs of all running claude.exe processes, or null where the process table is not supported. */
export function claudeProcesses(): number[] | null {
  return win ? win.claudeProcessIds() : null;
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

/** Opens a terminal tab running a command in `cwd`; 'unsupported' outside Windows. */
export async function openTerminal(cwd: string, command: string[], env: NodeJS.ProcessEnv): Promise<'opened' | 'failed' | 'unsupported'> {
  if (!win) return 'unsupported';
  return (await win.openTerminalTab(cwd, command, env)) ? 'opened' : 'failed';
}

export type FocusResult = 'focused' | 'minimized' | 'notFound' | 'unsupported';

/** The session and window ccdash brought to front last; a second click on that tile sends the window away again. */
let lastFocus: { sessionId: string; hwnd: string } | null = null;

/**
 * Toggles the window hosting a Claude Code session: brings it to front (selecting the Windows Terminal tab), or
 * minimizes it when ccdash showed exactly this session last and the window is still frontmost on its monitor.
 */
export async function focusSession(sessionId: string, pid: number, titles: string[]): Promise<FocusResult> {
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
