// Linux: select the session's pane in tmux, WezTerm or kitty, bring its terminal window to the front (X11 via
// xdotool), open new sessions in the first installed terminal, and start with the desktop session through an XDG
// autostart entry.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ancestors, onPath, processTable, run, selectTerminalPane, sessionTerminal } from './unix';

export type LinuxFocus = 'focused' | 'notFound' | 'noX11' | 'noXdotool';

/** A shell word in single quotes. */
function quote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

interface TerminalSpec {
  name: string;
  args: (cwd: string, command: string[]) => string[];
}

/** Terminals in order of preference, each with how it takes a working directory and a command. */
export const LINUX_TERMINALS: TerminalSpec[] = [
  { name: 'gnome-terminal', args: (cwd, cmd) => [`--working-directory=${cwd}`, '--', ...cmd] },
  { name: 'konsole', args: (cwd, cmd) => ['--workdir', cwd, '-e', ...cmd] },
  { name: 'kitty', args: (cwd, cmd) => ['--directory', cwd, ...cmd] },
  { name: 'wezterm', args: (cwd, cmd) => ['start', '--cwd', cwd, '--', ...cmd] },
  { name: 'alacritty', args: (cwd, cmd) => ['--working-directory', cwd, '-e', ...cmd] },
  { name: 'ghostty', args: (cwd, cmd) => [`--working-directory=${cwd}`, '-e', ...cmd] },
  { name: 'xfce4-terminal', args: (cwd, cmd) => [`--working-directory=${cwd}`, '-x', ...cmd] },
  { name: 'tilix', args: (cwd, cmd) => [`--working-directory=${cwd}`, '-e', cmd.map(quote).join(' ')] },
  { name: 'foot', args: (cwd, cmd) => [`--working-directory=${cwd}`, ...cmd] },
  { name: 'xterm', args: (cwd, cmd) => ['-e', 'sh', '-c', `cd ${quote(cwd)} && exec ${cmd.map(quote).join(' ')}`] },
];

export function openTerminalTab(cwd: string, command: string[], env: NodeJS.ProcessEnv): Promise<boolean> {
  const terminal = LINUX_TERMINALS.find((t) => onPath(t.name));
  if (!terminal) return Promise.resolve(false);
  return new Promise((resolve) => {
    const child = spawn(terminal.name, terminal.args(cwd, command), { cwd, env, detached: true, stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('spawn', () => {
      child.unref();
      resolve(true);
    });
  });
}

/** Window ids of a process (visible ones only). */
async function windowsOf(pid: number): Promise<string[]> {
  const output = await run('xdotool', ['search', '--onlyvisible', '--pid', String(pid)]).catch(() => '');
  return output.split('\n').map((l) => l.trim()).filter((l) => /^\d+$/.test(l));
}

/**
 * Shows the session's pane (tmux, WezTerm, kitty) and brings the window hosting it to the front: the nearest ancestor
 * process (terminal, terminal server or IDE) that owns a window; for a session in tmux, the terminal of the tmux
 * client used last. Among several windows of that process the one whose title contains the session title wins.
 * Wayland compositors do not let other apps raise windows, so raising needs X11 (or XWayland) and xdotool.
 */
export async function focusSession(pid: number, titles: string[]): Promise<LinuxFocus> {
  const shown = await sessionTerminal(pid);
  const chain = ancestors(shown.pid, await processTable());
  await selectTerminalPane(shown, chain).catch(() => undefined);
  if (!process.env['DISPLAY']) return 'noX11';
  if (!onPath('xdotool')) return 'noXdotool';
  for (const ancestor of chain.slice(1)) {
    const windows = await windowsOf(ancestor.pid);
    if (windows.length === 0) continue;
    let target = windows[0]!;
    for (const id of windows) {
      const name = await run('xdotool', ['getwindowname', id]).catch(() => '');
      if (titles.some((t) => name.includes(t))) {
        target = id;
        break;
      }
    }
    await run('xdotool', ['windowactivate', target]);
    return 'focused';
  }
  return 'notFound';
}

// ---- autostart ----------------------------------------------------------------------------------------

export function autostartPath(): string {
  const config = process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config');
  return join(config, 'autostart', 'agenttiles.desktop');
}

/**
 * The Exec value of a desktop entry (Desktop Entry spec, "The Exec key"): an argument with a reserved character goes
 * in double quotes with " ` $ \ escaped, a literal % is doubled, and because Exec is a string value, every backslash
 * is escaped once more and line breaks and tabs become \n, \t and \r.
 */
export function execValue(exec: string[]): string {
  const args = exec.map((arg) => (/[\s"'\\><~|&;$*?#()`]/.test(arg) ? `"${arg.replace(/(["`$\\])/g, '\\$1')}"` : arg));
  return args
    .join(' ')
    .replace(/%/g, '%%')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r');
}

/** An XDG desktop entry that starts `exec` (program and arguments) with the desktop session. */
export function desktopEntry(exec: string[]): string {
  return ['[Desktop Entry]', 'Type=Application', 'Name=AgentTiles', 'Comment=Dashboard for Claude Code sessions', `Exec=${execValue(exec)}`, 'X-GNOME-Autostart-enabled=true', ''].join('\n');
}

export function setAutostart(enabled: boolean, exec: string[]): void {
  const path = autostartPath();
  if (!enabled) {
    if (existsSync(path)) rmSync(path);
    return;
  }
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, desktopEntry(exec));
}
