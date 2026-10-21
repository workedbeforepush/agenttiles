// Runs the macOS / Linux helpers against the real system (CI runs these on macOS and Linux runners).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adoptLoginShellPath, ancestors, processTable } from '../src/main/platform/unix';
import { openScript, selectTabScript } from '../src/main/platform/mac';

describe.skipIf(process.platform === 'win32')('unix helpers on this machine', () => {
  it('reads the process table and finds this process with its parents', async () => {
    const table = await processTable();
    const chain = ancestors(process.pid, table);
    expect(chain[0]?.pid).toBe(process.pid);
    expect(chain.length).toBeGreaterThan(1);
  });

  it('takes the PATH that the login shell profile sets up', async () => {
    // Like Homebrew or nvm: the user's profile adds a directory that a Dock or launcher start would not see.
    const home = mkdtempSync(join(tmpdir(), 'ccdash-home-'));
    writeFileSync(join(home, '.bash_profile'), 'export PATH="/ccdash-test/bin:$PATH"
');
    const saved = { PATH: process.env['PATH'], HOME: process.env['HOME'], SHELL: process.env['SHELL'] };
    Object.assign(process.env, { PATH: '/usr/bin:/bin', HOME: home, SHELL: '/bin/bash' });
    try {
      await adoptLoginShellPath();
      expect(process.env['PATH']?.split(':')).toEqual(expect.arrayContaining(['/ccdash-test/bin', '/usr/bin', '/bin']));
    } finally {
      Object.assign(process.env, saved);
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe.skipIf(process.platform !== 'darwin')('AppleScript on macOS', () => {
  it('compiles every generated script', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccdash-osa-'));
    try {
      const scripts = [
        selectTabScript('Terminal', '/dev/ttys003'),
        selectTabScript('iTerm2', '/dev/ttys003'),
        openScript('Terminal', "/Users/me/it's \"here\"", ['claude', '--resume', 'abc']),
        openScript('iTerm2', '/tmp', ['claude']),
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
