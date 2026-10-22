// Windows Terminal command lines; pure, so tests run on every OS (windows.ts loads Win32 DLLs).
import type { TerminalTarget } from '../../core/types';

/** wt.exe arguments that run `command` in `cwd`: a new tab in the most recent window, or a new window. */
export function wtArgs(cwd: string, command: string[], target: TerminalTarget): string[] {
  // wt.exe splits its command line at ';' (subcommand separator) unless it is escaped.
  // Escape backslashes first so existing escapes cannot interfere with semicolon escaping.
  const escape = (arg: string): string => arg.replace(/\\/g, '\\\\').replace(/;/g, '\\;');
  return ['-w', target === 'window' ? 'new' : '0', 'new-tab', '-d', escape(cwd), ...command.map(escape)];
}
