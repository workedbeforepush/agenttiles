import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHELL_PATH_COMMAND, ancestors, mergePath, onPath, parseLstart, parsePs, parseShellPath } from '../src/main/platform/unix';
import { wtArgs } from '../src/main/platform/wt';
import { appBundleOf, appleString, hostApp, openScript, selectTabScript, shellQuote, terminalOf } from '../src/main/platform/mac';
import { LINUX_TERMINALS, desktopEntry, execValue } from '../src/main/platform/linux';
import { findWezTermPane, parseWezTermPanes, siblingExecutable, titleMatches, weztermActivateArgs } from '../src/main/platform/wezterm';
import { TMUX_CLIENTS_ARGS, TMUX_PANES_ARGS, parseTmuxClients, parseTmuxPanes, pickTmuxClient, tmuxSwitchArgs } from '../src/main/platform/tmux';
import { environmentValue, kittyFocusArgs } from '../src/main/platform/kitty';

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

  it('reads the start time the way the registry records procStart', () => {
    expect(parseLstart('Wed Oct  1 08:03:12 2026\n')).toBe('Wed Oct  1 08:03:12 2026');
    expect(parseLstart('\n')).toBeNull();
  });
});

describe('PATH lookup', () => {
  it('counts a file, not a directory with the same name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agenttiles-path-'));
    const saved = process.env['PATH'];
    try {
      mkdirSync(join(dir, 'kitty'));
      writeFileSync(join(dir, 'foot'), '');
      process.env['PATH'] = dir;
      expect(onPath('kitty')).toBe(false);
      expect(onPath('foot')).toBe(true);
      expect(onPath('xterm')).toBe(false);
    } finally {
      process.env['PATH'] = saved;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('login shell PATH', () => {
  it('reads the PATH between markers and ignores shell startup noise', () => {
    expect(parseShellPath('Welcome!\n__AGENTTILES_PATH__/opt/homebrew/bin:/usr/bin__AGENTTILES_PATH__')).toBe('/opt/homebrew/bin:/usr/bin');
    expect(parseShellPath('no markers here')).toBeNull();
  });

  it('asks the shell in a way fish understands too', () => {
    // fish has no ${VAR} syntax.
    expect(SHELL_PATH_COMMAND).not.toContain('${');
    expect(SHELL_PATH_COMMAND).toContain('printenv PATH');
    expect(parseShellPath('__AGENTTILES_PATH__\n/usr/local/bin:/usr/bin\n__AGENTTILES_PATH__\n')).toBe('/usr/local/bin:/usr/bin');
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

  it('refuses a folder with control characters, which the shell line editor would act on', () => {
    expect(() => openScript('Terminal', '/tmp/a\nrm -rf ~', ['claude'], 'tab')).toThrow('control character');
    expect(() => openScript('iTerm2', '/tmp/a\tb', ['claude'], 'tab')).toThrow('control character');
    expect(() => openScript('iTerm2', '/tmp/a\x1bb', ['claude'], 'tab')).toThrow('control character');
    expect(() => openScript('iTerm2', '/tmp/a\x7fb', ['claude'], 'tab')).toThrow('control character');
    expect(openScript('iTerm2', '/tmp/Wärme ü', ['claude'], 'tab')).toContain("cd '/tmp/Wärme ü'");
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

  it('escapes Exec arguments as the Desktop Entry spec says', () => {
    expect(execValue(['/opt/app/agenttiles', '--flag'])).toBe('/opt/app/agenttiles --flag');
    expect(execValue(['/home/me/100%/app'])).toBe('/home/me/100%%/app');
    // Quoted with \$ inside the quotes, then the backslash doubled for the string value.
    expect(execValue(['/home/me/a$b'])).toBe(String.raw`"/home/me/a\\$b"`);
    expect(execValue(['/home/me/say "hi"'])).toBe(String.raw`"/home/me/say \\"hi\\""`);
    expect(execValue([String.raw`/home/me/back\slash`])).toBe(String.raw`"/home/me/back\\\\slash"`);
    expect(execValue(['/home/me/a&b', '/home/me/(x)', '/home/me/~', "/home/me/it's"])).toBe(
      `"/home/me/a&b" "/home/me/(x)" "/home/me/~" "/home/me/it's"`,
    );
    expect(execValue(['/home/me/a\nb'])).toBe(String.raw`"/home/me/a\nb"`);
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
    // wt.exe does not unescape '\\': backslashes must reach it unchanged, or UNC paths break.
    expect(wtArgs('\\\\server\\share\\proj', ['claude'], 'tab')[4]).toBe('\\\\server\\share\\proj');
    expect(wtArgs('C:\\dev\\a;b', ['claude'], 'tab')[4]).toBe('C:\\dev\\a\\;b');
    expect(wtArgs('C:\\dev\\;x', ['claude'], 'tab')[4]).toBe('C:\\dev\\\\;x');
  });
});

// Shape of `wezterm cli list --format json` (fields AgentTiles does not read left out).
const WEZTERM_LIST = JSON.stringify([
  { window_id: 0, tab_id: 0, pane_id: 0, title: 'zsh', window_title: '[1/2] zsh', tty_name: '/dev/ttys001' },
  { window_id: 0, tab_id: 1, pane_id: 3, title: '✳ Fix the login', window_title: '[1/2] zsh', tty_name: '/dev/ttys004' },
  { window_id: 1, tab_id: 2, pane_id: 5, title: '⠂ Write the docs', window_title: '⠂ Write the docs', tty_name: null },
]);

describe('WezTerm', () => {
  const panes = parseWezTermPanes(WEZTERM_LIST);

  it('reads the panes of `wezterm cli list`', () => {
    expect(panes[1]).toEqual({ paneId: 3, title: '✳ Fix the login', windowTitle: '[1/2] zsh', tty: '/dev/ttys004' });
    expect(panes[2]?.tty).toBeNull();
    expect(() => parseWezTermPanes('{}')).toThrow('did not return a list');
  });

  it('finds the pane by tty where WezTerm knows it, by title otherwise', () => {
    expect(findWezTermPane(panes, '/dev/ttys004', [])?.paneId).toBe(3);
    expect(findWezTermPane(panes, '/dev/ttys009', ['Fix the login'])).toBeNull();
    expect(findWezTermPane(panes, null, ['Write the docs'])?.paneId).toBe(5);
    expect(findWezTermPane(panes, null, ['Write'])).toBeNull();
  });

  it('matches titles with and without the spinner prefix only', () => {
    expect(titleMatches('Fix', ['Fix'])).toBe(true);
    expect(titleMatches('✳ Fix', ['Fix'])).toBe(true);
    expect(titleMatches('Prefix', ['Fix'])).toBe(false);
  });

  it('runs the CLI installed next to the GUI', () => {
    expect(weztermActivateArgs(3)).toEqual(['cli', 'activate-pane', '--pane-id', '3']);
    expect(siblingExecutable(String.raw`C:\Program Files\WezTerm\wezterm-gui.exe`, 'wezterm.exe')).toBe(String.raw`C:\Program Files\WezTerm\wezterm.exe`);
    expect(siblingExecutable('/Applications/WezTerm.app/Contents/MacOS/wezterm-gui', 'wezterm')).toBe('/Applications/WezTerm.app/Contents/MacOS/wezterm');
    expect(siblingExecutable('wezterm-gui', 'wezterm')).toBe('wezterm');
  });
});

describe('tmux', () => {
  const panes = parseTmuxPanes('/dev/pts/3 %0 work\n/dev/pts/5 %4 my  notes\n\n');
  const clients = parseTmuxClients('/dev/pts/1 900 1792000100 work\n/dev/pts/2 901 1792000200 other\n');

  it('asks for the session name last, as it can have spaces', () => {
    expect(TMUX_PANES_ARGS).toEqual(['list-panes', '-a', '-F', '#{pane_tty} #{pane_id} #{session_name}']);
    expect(TMUX_CLIENTS_ARGS[2]).toBe('#{client_tty} #{client_pid} #{client_activity} #{client_session}');
    expect(panes).toEqual([
      { tty: '/dev/pts/3', paneId: '%0', session: 'work' },
      { tty: '/dev/pts/5', paneId: '%4', session: 'my  notes' },
    ]);
    expect(clients[0]).toEqual({ tty: '/dev/pts/1', pid: 900, activity: 1792000100, session: 'work' });
  });

  it('shows the pane in the latest client on its session, else in the latest client', () => {
    expect(pickTmuxClient(clients, panes[0]!)?.pid).toBe(900);
    expect(pickTmuxClient(clients, panes[1]!)?.pid).toBe(901);
    expect(pickTmuxClient([], panes[0]!)).toBeNull();
    expect(tmuxSwitchArgs(clients[0]!, panes[1]!)).toEqual(['switch-client', '-c', '/dev/pts/1', '-t', '%4']);
  });
});

describe('kitty', () => {
  it('reads the remote control address from either environment format', () => {
    expect(environmentValue('SHELL=/bin/zsh\0KITTY_LISTEN_ON=unix:/tmp/kitty-812\0KITTY_WINDOW_ID=2\0', 'KITTY_LISTEN_ON')).toBe('unix:/tmp/kitty-812');
    expect(environmentValue('-zsh TERM=xterm-kitty KITTY_LISTEN_ON=unix:/tmp/kitty-812 HOME=/Users/me\n', 'KITTY_LISTEN_ON')).toBe('unix:/tmp/kitty-812');
    expect(environmentValue('SHELL=/bin/zsh\0MY_KITTY_LISTEN_ON=x\0KITTY_LISTEN_ON=\0', 'KITTY_LISTEN_ON')).toBeNull();
  });

  it('focuses the window by the process kitty started in it', () => {
    expect(kittyFocusArgs('unix:/tmp/kitty-812', 4711)).toEqual(['@', '--to', 'unix:/tmp/kitty-812', 'focus-window', '--match', 'pid:4711']);
  });
});
