// Runs the macOS / Linux helpers against the real system (CI runs these on macOS and Linux runners).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adoptLoginShellPath, ancestors, onPath, processTable } from '../src/main/platform/unix';
import { openScript, selectTabScript } from '../src/main/platform/mac';
import { TMUX_CLIENTS_ARGS, TMUX_PANES_ARGS, parseTmuxClients, parseTmuxPanes } from '../src/main/platform/tmux';

describe.skipIf(process.platform === 'win32')('unix helpers on this machine', () => {
  it('reads the process table and finds this process with its parents', async () => {
    const table = await processTable();
    const chain = ancestors(process.pid, table);
    expect(chain[0]?.pid).toBe(process.pid);
    expect(chain.length).toBeGreaterThan(1);
  });

  it('takes the PATH that the login shell profile sets up', async () => {
    // Like Homebrew or nvm: the user's profile adds a directory that a Dock or launcher start would not see.
    const home = mkdtempSync(join(tmpdir(), 'agenttiles-home-'));
    writeFileSync(join(home, '.bash_profile'), 'export PATH="/agenttiles-test/bin:$PATH"\n');
    const saved = { PATH: process.env['PATH'], HOME: process.env['HOME'], SHELL: process.env['SHELL'] };
    Object.assign(process.env, { PATH: '/usr/bin:/bin', HOME: home, SHELL: '/bin/bash' });
    try {
      await adoptLoginShellPath();
      expect(process.env['PATH']?.split(':')).toEqual(expect.arrayContaining(['/agenttiles-test/bin', '/usr/bin', '/bin']));
    } finally {
      Object.assign(process.env, saved);
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe.skipIf(process.platform === 'win32' || !onPath('tmux'))('tmux on this machine', () => {
  it('lists panes in the format AgentTiles parses', () => {
    // A server of its own (-L), so a tmux the developer runs is left alone.
    const tmux = (args: string[]): string => execFileSync('tmux', ['-L', `agenttiles-${process.pid}`, ...args], { encoding: 'utf8' });
    tmux(['new-session', '-d', '-s', 'agent tiles', 'sleep 30']);
    try {
      const panes = parseTmuxPanes(tmux(TMUX_PANES_ARGS));
      expect(panes).toHaveLength(1);
      expect(panes[0]?.session).toBe('agent tiles');
      expect(panes[0]?.paneId).toMatch(/^%\d+$/);
      expect(panes[0]?.tty).toMatch(/^\/dev\//);
      expect(parseTmuxClients(tmux(TMUX_CLIENTS_ARGS))).toEqual([]);
    } finally {
      tmux(['kill-server']);
    }
  });
});

describe.skipIf(process.platform !== 'darwin')('AppleScript on macOS', () => {
  it('compiles every generated script', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agenttiles-osa-'));
    try {
      const scripts = [
        selectTabScript('Terminal', '/dev/ttys003'),
        selectTabScript('iTerm2', '/dev/ttys003'),
        openScript('Terminal', "/Users/me/it's \"here\"", ['claude', '--resume', 'abc'], 'tab'),
        openScript('iTerm2', '/tmp', ['claude'], 'tab'),
        openScript('iTerm2', '/tmp', ['claude'], 'window'),
      ];
      for (const [i, script] of scripts.entries()) {
        // osacompile checks the syntax without running anything (the iTerm2 dictionary is not needed for that:
        // unknown terms of an app that is not installed would fail, so iTerm2 scripts compile only where iTerm2 is).
        if (script.includes('iTerm2') && !existsApp('iTerm')) continue;
        execFileSync('osacompile', ['-o', join(dir, `s${i}.scpt`), '-e', script]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function existsApp(name: string): boolean {
  try {
    execFileSync('open', ['-Ra', name]);
    return true;
  } catch {
    return false;
  }
}
