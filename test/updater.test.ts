import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({}));
const { Updater, compareVersions, updateCommand, updateScript } = await import('../src/main/updater');

describe('versions', () => {
  it('compares x.y.z numerically and puts pre-releases before their release', () => {
    expect(compareVersions('0.10.0', '0.9.3')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0);
  });
});

describe('update script', () => {
  it('waits, installs the exact version with its output in update.log, and starts the new version', () => {
    const win = updateScript('win32', '0.3.0');
    expect(win.name).toBe('update.cmd');
    expect(win.text).toContain('call npm install -g agenttiles@0.3.0 > "%~dp0update.log" 2>&1');
    expect(win.text.trim().split('\r\n').at(-1)).toBe('call agenttiles');
    const sh = updateScript('linux', '0.3.0');
    expect(sh.text).toContain('npm install -g agenttiles@0.3.0 > "$(dirname "$0")/update.log" 2>&1');
    expect(updateCommand('0.3.0')).toBe('npm install -g agenttiles@0.3.0');
  });
});

describe('updater', () => {
  it('reports a failed update from the previous run with the end of npm output', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agenttiles-update-'));
    try {
      writeFileSync(join(dir, 'update.json'), JSON.stringify({ target: '0.3.0' }));
      writeFileSync(join(dir, 'update.log'), 'npm error code EACCES\nnpm error permission denied\n');
      const view = new Updater(dir, dir, '0.2.0').view();
      expect(view.failed).toContain('permission denied');
      expect(view.available).toBeNull();
      // The marker is consumed: the next start does not report it again.
      expect(new Updater(dir, dir, '0.2.0').view().failed).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('forgets the marker when the update worked', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agenttiles-update-'));
    try {
      writeFileSync(join(dir, 'update.json'), JSON.stringify({ target: '0.3.0' }));
      expect(new Updater(dir, dir, '0.3.0').view().failed).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
