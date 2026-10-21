import { describe, expect, it } from 'vitest';
import {
  HOOK_EVENTS,
  anyHooksInstalled,
  hooksInstalled,
  installHooks,
  installStatusline,
  statuslineInstalled,
  uninstallHooks,
  uninstallStatusline,
} from '../src/core/hookConfig';

const options = { nodePath: 'C:\\nodejs\\node.exe', hookPath: 'C:\\data\\agenttiles\\agenttiles-hook.js', permissionTimeoutSec: 600 };

const foreign = {
  model: 'opus',
  permissions: { allow: ['Bash(git:*)'] },
  hooks: {
    PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: '/usr/local/bin/format.sh' }] }],
  },
};

describe('hooks', () => {
  it('installs every event and keeps foreign settings and hooks', () => {
    const result = installHooks(foreign, options);
    expect(result['model']).toBe('opus');
    expect(result['permissions']).toEqual(foreign.permissions);
    const hooks = result['hooks'] as Record<string, unknown[]>;
    expect(Object.keys(hooks).sort()).toEqual([...HOOK_EVENTS].sort());
    expect(hooks['PostToolUse']).toHaveLength(2);
    expect(hooks['PostToolUse']?.[0]).toEqual(foreign.hooks.PostToolUse[0]);
    expect(hooksInstalled(result, options)).toBe(true);
  });

  it('uses exec form, async everywhere except PermissionRequest', () => {
    const hooks = installHooks({}, options)['hooks'] as Record<string, { hooks: Record<string, unknown>[] }[]>;
    const stop = hooks['Stop']?.[0]?.hooks[0];
    expect(stop).toEqual({ type: 'command', command: options.nodePath, args: [options.hookPath, 'hook'], async: true });
    const permission = hooks['PermissionRequest']?.[0]?.hooks[0];
    expect(permission?.['async']).toBeUndefined();
    expect(permission?.['timeout']).toBe(630);
  });

  it('is idempotent and detects a changed timeout', () => {
    const once = installHooks(foreign, options);
    expect(installHooks(once, options)).toEqual(once);
    expect(hooksInstalled(once, { ...options, permissionTimeoutSec: 120 })).toBe(false);
  });

  it('uninstalls only its own hooks', () => {
    const removed = uninstallHooks(installHooks(foreign, options));
    expect(removed).toEqual(foreign);
    expect(anyHooksInstalled(removed)).toBe(false);
    expect(uninstallHooks(installHooks({}, options))).toEqual({});
  });
});

describe('statusline', () => {
  it('replaces a foreign statusline and hands it back for chaining', () => {
    const previous = { type: 'command', command: 'my-status.sh', padding: 1 };
    const { settings, previous: replaced } = installStatusline({ statusLine: previous }, options.nodePath, options.hookPath);
    expect(replaced).toEqual(previous);
    expect(statuslineInstalled(settings)).toBe(true);
    expect((settings['statusLine'] as { command: string }).command).toBe(
      '"C:/nodejs/node.exe" "C:/data/agenttiles/agenttiles-hook.js" statusline',
    );
    expect(uninstallStatusline(settings, replaced)).toEqual({ statusLine: previous });
  });

  it('removes the statusline entirely when there was none before', () => {
    const { settings, previous } = installStatusline({}, options.nodePath, options.hookPath);
    expect(previous).toBeNull();
    expect(uninstallStatusline(settings, null)).toEqual({});
  });
});
