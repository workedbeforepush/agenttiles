// Installs into a temporary CLAUDE_CONFIG_DIR, never into the real ~/.claude.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Integration } from '../src/main/integration';

const root = mkdtempSync(join(tmpdir(), 'agenttiles-int-'));
const claudeDir = join(root, 'claude');
const userData = join(root, 'userData');
const bundledHook = join(root, 'bundled-hook.js');
const settingsPath = join(claudeDir, 'settings.json');
const original = {
  model: 'opus',
  statusLine: { type: 'command', command: 'my-status.sh' },
  hooks: { Stop: [{ hooks: [{ type: 'command', command: 'notify.sh' }] }] },
};
let previousEnv: string | undefined;

function settings(): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
}

beforeAll(() => {
  previousEnv = process.env['CLAUDE_CONFIG_DIR'];
  process.env['CLAUDE_CONFIG_DIR'] = claudeDir;
  for (const dir of [claudeDir, userData]) rmSync(dir, { recursive: true, force: true });
  mkdirSync(claudeDir, { recursive: true });
  mkdirSync(userData, { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(original, null, 2));
  writeFileSync(bundledHook, '// hook v1');
});

afterAll(() => {
  if (previousEnv === undefined) delete process.env['CLAUDE_CONFIG_DIR'];
  else process.env['CLAUDE_CONFIG_DIR'] = previousEnv;
  rmSync(root, { recursive: true, force: true });
});

describe('Integration', () => {
  const integration = new Integration(userData, bundledHook);

  it('installs hooks and the statusline wrapper and reports them', () => {
    integration.setHooks(true, 600);
    integration.setStatusline(true);
    const status = integration.status(600);
    expect(status.error).toBeNull();
    expect(status.hooksInstalled).toBe(true);
    expect(status.statuslineInstalled).toBe(true);
    expect(status.nodePath).toMatch(/node(\.exe)?$/i);
    expect(readFileSync(join(userData, 'agenttiles-hook.js'), 'utf8')).toBe('// hook v1');
    expect(JSON.parse(readFileSync(join(userData, 'statusline-chain.json'), 'utf8'))).toEqual(original.statusLine);
    expect(settings()['model']).toBe('opus');
  });

  it('reports hooks as outdated when the permission timeout changes, and repairs them', () => {
    expect(integration.status(120).hooksInstalled).toBe(false);
    integration.repair(120);
    expect(integration.status(120).hooksInstalled).toBe(true);
  });

  it('repairs an outdated statusline command and keeps the stored chain', () => {
    const current = settings();
    writeFileSync(
      settingsPath,
      JSON.stringify({ ...current, statusLine: { type: 'command', command: '"C:/old/node.exe" "C:/old/agenttiles-hook.js" statusline' } }),
    );
    expect(integration.status(120).statuslineInstalled).toBe(false);
    integration.repair(120);
    expect(integration.status(120).statuslineInstalled).toBe(true);
    expect(JSON.parse(readFileSync(join(userData, 'statusline-chain.json'), 'utf8'))).toEqual(original.statusLine);
  });

  it('re-copies the hook script when the bundled version changes', () => {
    writeFileSync(bundledHook, '// hook v2');
    integration.syncHookScript();
    expect(readFileSync(join(userData, 'agenttiles-hook.js'), 'utf8')).toBe('// hook v2');
  });

  it('restores the original settings on uninstall', () => {
    integration.setHooks(false, 120);
    integration.setStatusline(false);
    expect(settings()).toEqual(original);
    expect(existsSync(join(userData, 'statusline-chain.json'))).toBe(false);
  });

  it('writes through a symlinked settings.json instead of replacing the link', (context) => {
    const real = join(root, 'dotfiles-settings.json');
    writeFileSync(real, JSON.stringify(original, null, 2));
    rmSync(settingsPath);
    try {
      symlinkSync(real, settingsPath, 'file');
    } catch {
      context.skip(); // creating symlinks needs developer mode or elevation on Windows
      return;
    }
    integration.setHooks(true, 120);
    expect(lstatSync(settingsPath).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, 'utf8')).toContain('agenttiles-hook.js');
    integration.setHooks(false, 120);
    expect(JSON.parse(readFileSync(real, 'utf8'))).toEqual(original);
  });
});
