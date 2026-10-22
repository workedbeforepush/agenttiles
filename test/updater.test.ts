import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({}));
// The update script must not really run: every spawn fails like a missing shell would.
vi.mock('node:child_process', async (importActual) => ({
  ...(await importActual<typeof import('node:child_process')>()),
  spawn: () => {
    const child = Object.assign(new EventEmitter(), { unref: () => undefined });
    setImmediate(() => child.emit('error', new Error('spawn cmd.exe ENOENT')));
    return child;
  },
}));
const { Updater, cmdArgs, compareVersions, latestVersion, releaseUrl, shouldAnnounce, updateCommand, updateScript } = await import(
  '../src/main/updater'
);

describe('versions', () => {
  it('compares x.y.z numerically and puts pre-releases before their release', () => {
    expect(compareVersions('0.10.0', '0.9.3')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0);
  });

  it('takes only an x.y.z version from the registry, since it ends up in the update script', () => {
    expect(latestVersion({ version: '1.4.0' })).toBe('1.4.0');
    expect(latestVersion({ version: '2.0.0-beta.1' })).toBe('2.0.0-beta.1');
    expect(latestVersion({ version: '1.4.0 & calc' })).toBeNull();
    expect(latestVersion({ version: '1.4.0\nrm -rf ~' })).toBeNull();
    expect(latestVersion({ version: 'latest' })).toBeNull();
    expect(latestVersion({ version: 140 })).toBeNull();
    expect(latestVersion({})).toBeNull();
    expect(latestVersion(null)).toBeNull();
  });
});

describe('update notice', () => {
  it('announces each newer version once', () => {
    expect(shouldAnnounce('0.3.0', null)).toBe(true);
    expect(shouldAnnounce('0.3.0', '0.3.0')).toBe(false);
    expect(shouldAnnounce('0.3.0', '0.4.0')).toBe(false);
    expect(shouldAnnounce('0.4.0', '0.3.0')).toBe(true);
    expect(shouldAnnounce('1.0.0', '1.0.0-beta.1')).toBe(true);
  });

  it('links the GitHub release of an x.y.z version and nothing else', () => {
    expect(releaseUrl('0.3.0')).toBe('https://github.com/workedbeforepush/agenttiles/releases/tag/v0.3.0');
    expect(releaseUrl('1.0.0-beta.1')).toBe('https://github.com/workedbeforepush/agenttiles/releases/tag/v1.0.0-beta.1');
    expect(() => releaseUrl('0.3.0/../../evil')).toThrow();
    expect(() => releaseUrl('latest')).toThrow();
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

  it('quotes the script path for cmd.exe so & and ( in the folder stay part of it', () => {
    expect(cmdArgs('C:\\Users\\A&B (x)\\update.cmd')).toEqual(['/d', '/s', '/c', '""C:\\Users\\A&B (x)\\update.cmd""']);
  });

  it.runIf(process.platform === 'win32')('runs a script in a folder with & and ( through cmd.exe', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'agenttiles-update-')), 'A&B (x)');
    try {
      mkdirSync(dir);
      const script = join(dir, 'update.cmd');
      writeFileSync(script, '@echo off\r\necho ran > "%~dp0ran.txt"\r\n');
      spawnSync('cmd.exe', cmdArgs(script), { windowsVerbatimArguments: true, stdio: 'ignore' });
      expect(existsSync(join(dir, 'ran.txt'))).toBe(true);
    } finally {
      rmSync(join(dir, '..'), { recursive: true, force: true });
    }
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

  it('translates the note for a failed update without npm output when the view is built', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agenttiles-update-'));
    try {
      writeFileSync(join(dir, 'update.json'), JSON.stringify({ target: '0.3.0' }));
      const updater = new Updater(dir, dir, '0.2.0');
      expect(updater.view().failed).toBe('npm did not install the update.');
      // A language switch after start: the next view speaks the new language.
      expect(updater.view((key) => `de:${key}`).failed).toBe('de:main.update.npmNoInstall');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('drops the marker when the update script does not start', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agenttiles-update-'));
    try {
      const installing = new Updater(dir, dir, '0.2.0').install('0.3.0');
      expect(existsSync(join(dir, 'update.json'))).toBe(true);
      await expect(installing).rejects.toThrow();
      expect(existsSync(join(dir, 'update.json'))).toBe(false);
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
