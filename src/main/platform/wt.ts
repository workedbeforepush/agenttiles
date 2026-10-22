// Windows Terminal command lines; pure, so tests run on every OS (windows.ts loads Win32 DLLs).
import type { TerminalTarget } from '../../core/types';

/** wt.exe arguments that run `command` in `cwd`: a new tab in the most recent window, or a new window. */
export function wtArgs(cwd: string, command: string[], target: TerminalTarget): string[] {
  // wt.exe splits its command line at ';' (subcommand separator) unless it is escaped as '\;'. Backslashes stay as
  // they are: wt.exe does not unescape '\\', so doubling them breaks UNC paths (\\server\share), and a '\' before ';'
  // still comes out right ('\\;' reads as '\' plus an escaped ';').
  const escape = (arg: string): string => arg.split(';').join('\\;');
  return ['-w', target === 'window' ? 'new' : '0', 'new-tab', '-d', escape(cwd), ...command.map(escape)];
}
