import { delimiter } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ancestors, mergePath, parsePs, parseShellPath } from '../src/main/platform/unix';
import { wtArgs } from '../src/main/platform/wt';
import { appBundleOf, appleString, hostApp, openScript, selectTabScript, shellQuote, terminalOf } from '../src/main/platform/mac';
import { LINUX_TERMINALS, desktopEntry } from '../src/main/platform/linux';

// Shapes of `ps -axo pid=,ppid=,comm=` on macOS (full paths, with spaces) and Linux (names).
const MAC_PS = `
    1     0 /sbin/launchd
  501     1 /Applications/iTerm.app/Contents/MacOS/iTerm2
  733   501 /usr/bin/login
  734   733 -zsh
  900   734 /Users/me/.local/bin/claude
  950     1 /Applications/Visual Studio Code.app/Contents/MacOS/Electron
  960   950 /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper
  970   960 /bin/zsh
  980   970 claude
`;

describe('process table', () => {
  it('parses ps output with spaces in paths and walks the ancestors', () => {
    const table = parsePs(MAC_PS);
    expect(table.get(950)?.comm).toBe('/Applications/Visual Studio Code.app/Contents/MacOS/Electron');
    expect(ancestors(900, table).map((p) => p.pid)).toEqual([900, 734, 733, 501]);
  });

  it('stops on loops and unknown parents', () => {
    const table = parsePs('10 11 a\n11 10 b\n');
    expect(ancestors(10, table).map((p) => p.pid)).toEqual([10, 11]);
    expect(ancestors(99, table)).toEqual([]);
  });
});

describe('login shell PATH', () => {
  it('reads the PATH between markers and ignores shell startup noise', () => {
    expect(parseShellPath('Welcome!\n__AGENTTILES_PATH__/opt/homebrew/bin:/usr/bin__AGENTTILES_PATH__')).toBe('/opt/homebrew/bin:/usr/bin');
    expect(parseShellPath('no markers here')).toBeNull();
  });

  it('puts the shell entries first without duplicates', () => {
    const j = (...parts: string[]): string => parts.join(delimiter);
    expect(mergePath(j('/usr/bin', '/bin'), j('/opt/homebrew/bin', '/usr/bin'))).toBe(j('/opt/homebrew/bin', '/usr/bin', '/bin'));
  });
});

describe('macOS', () => {
  const table = parsePs(MAC_PS);

  it('finds the hosting app bundle and the terminal kind', () => {
    expect(appBundleOf('/Applications/iTerm.app/Contents/MacOS/iTerm2')).toBe('/Applications/iTerm.app');
    expect(hostApp(ancestors(900, table))).toBe('/Applications/iTerm.app');
    // A session in VS Code's terminal runs under a helper bundle inside the app: the outer app is the host.
    expect(hostApp(ancestors(980, table))).toBe('/Applications/Visual Studio Code.app');
    expect(terminalOf('/Applications/iTerm.app')).toBe('iTerm2');
    expect(terminalOf('/System/Applications/Utilities/Terminal.app')).toBe('Terminal');
    expect(terminalOf('/Applications/Visual Studio Code.app')).toBeNull();
  });

  it('quotes for AppleScript and the shell', () => {
    expect(appleString('say "hi" \\ there')).toBe('"say \\"hi\\" \\\\ there"');
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  it('builds the tab selection and open scripts', () => {
    expect(selectTabScript('Terminal', '/dev/ttys003')).toContain('if tty of t is "/dev/ttys003" then');
    expect(selectTabScript('iTerm2', '/dev/ttys003')).toContain('repeat with s in sessions of t');
    const open = openScript('Terminal', '/Users/me/my "app"', ['claude', '--resume', 'abc'], 'tab');
    expect(open).toContain(`do script "cd '/Users/me/my \\"app\\"' && 'claude' '--resume' 'abc'"`);
    expect(openScript('iTerm2', '/tmp', ['claude'], 'tab')).toContain('if (count of windows) is 0 then');
    expect(openScript('iTerm2', '/tmp', ['claude'], 'window')).toContain('if true then');
  });
});

describe('Linux', () => {
  it('passes the working directory and command the way each terminal expects', () => {
    const args = (name: string): string[] => LINUX_TERMINALS.find((t) => t.name === name)!.args('/home/me/app', ['claude', '--resume', 'x']);
    expect(args('gnome-terminal')).toEqual(['--working-directory=/home/me/app', '--', 'claude', '--resume', 'x']);
    expect(args('konsole')).toEqual(['--workdir', '/home/me/app', '-e', 'claude', '--resume', 'x']);
    expect(args('xterm')).toEqual(['-e', 'sh', '-c', "cd '/home/me/app' && exec 'claude' '--resume' 'x'"]);
  });

  it('writes an XDG autostart entry with quoted paths', () => {
    const entry = desktopEntry(['/opt/agenttiles/agenttiles', '/home/me/my apps/agenttiles']);
    expect(entry).toContain('Exec=/opt/agenttiles/agenttiles "/home/me/my apps/agenttiles"');
    expect(entry).toContain('Type=Application');
  });
});

describe('Windows Terminal', () => {
  it('opens a tab in the last window or a new window, escaping the subcommand separator', () => {
    expect(wtArgs('C:/dev/a;b', ['claude', '--resume', 'x'], 'tab')).toEqual([
      '-w',
      '0',
      'new-tab',
      '-d',
      'C:/dev/a\\;b',
      'claude',
      '--resume',
      'x',
    ]);
    expect(wtArgs('C:/dev', ['claude'], 'window').slice(0, 3)).toEqual(['-w', 'new', 'new-tab']);
  });
});
