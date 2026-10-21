// Runs the macOS / Linux helpers against the real system (CI runs these on macOS and Linux runners).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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

  it('takes the PATH of the login shell', async () => {
    const before = process.env['PATH'];
    process.env['PATH'] = '/nonexistent';
    try {
      await adoptLoginShellPath();
      expect(process.env['PATH']?.split(':')).toContain('/usr/bin');
    } finally {
      process.env['PATH'] = before;
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
