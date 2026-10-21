// Pure merge logic for ccdash entries in Claude Code's ~/.claude/settings.json.
// Foreign hooks and settings are always preserved.

export const HOOK_SCRIPT_NAME = 'ccdash-hook.js';

/** Events ccdash registers. PostToolBatch is intentionally not registered: ccdash ignores it. */
export const HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
  'Notification',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'TaskCreated',
  'TaskCompleted',
  'PreCompact',
  'PostCompact',
  'MessageDisplay',
  'ConfigChange',
] as const;

export type ClaudeSettings = Record<string, unknown>;

interface HookHandler {
  type?: string;
  command?: string;
  args?: unknown[];
  [key: string]: unknown;
}

interface HookGroup {
  matcher?: string;
  hooks?: HookHandler[];
  [key: string]: unknown;
}

export interface InstallOptions {
  nodePath: string;
  hookPath: string;
  permissionTimeoutSec: number;
}

function isOurs(handler: HookHandler): boolean {
  const parts = [handler.command ?? '', ...(Array.isArray(handler.args) ? handler.args : [])];
  return parts.some((part) => typeof part === 'string' && part.includes(HOOK_SCRIPT_NAME));
}

function hooksObject(settings: ClaudeSettings): Record<string, HookGroup[]> {
  const hooks = settings['hooks'];
  return hooks && typeof hooks === 'object' ? (hooks as Record<string, HookGroup[]>) : {};
}

/** Removes ccdash handlers; a group disappears only when it held ccdash handlers and nothing else. */
function withoutOurs(groups: HookGroup[]): HookGroup[] {
  const result: HookGroup[] = [];
  for (const group of groups) {
    const all = Array.isArray(group.hooks) ? group.hooks : null;
    if (!all || !all.some(isOurs)) {
      result.push(group);
      continue;
    }
    const handlers = all.filter((handler) => !isOurs(handler));
    if (handlers.length > 0) result.push({ ...group, hooks: handlers });
  }
  return result;
}

function ourHandler(event: string, options: InstallOptions): HookHandler {
  const handler: HookHandler = {
    type: 'command',
    command: options.nodePath,
    args: [options.hookPath, 'hook'],
  };
  if (event === 'PermissionRequest') handler['timeout'] = options.permissionTimeoutSec + 30;
  else handler['async'] = true;
  return handler;
}

export function installHooks(settings: ClaudeSettings, options: InstallOptions): ClaudeSettings {
  const hooks: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(hooksObject(settings))) {
    const kept = withoutOurs(groups);
    // An event that only held ccdash entries from an older version disappears instead of staying as [].
    if (kept.length > 0 || groups.length === 0) hooks[event] = kept;
  }
  for (const event of HOOK_EVENTS) {
    hooks[event] = [...(hooks[event] ?? []), { hooks: [ourHandler(event, options)] }];
  }
  return { ...settings, hooks };
}

export function uninstallHooks(settings: ClaudeSettings): ClaudeSettings {
  const hooks: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(hooksObject(settings))) {
    const kept = withoutOurs(groups);
    if (kept.length > 0 || groups.length === 0) hooks[event] = kept;
  }
  const result = { ...settings };
  if (Object.keys(hooks).length > 0) result['hooks'] = hooks;
  else delete result['hooks'];
  return result;
}

/**
 * True when every ccdash event is registered with exactly the given hook script and timeout, and no other event
 * still carries a ccdash handler from an older version.
 */
export function hooksInstalled(settings: ClaudeSettings, options: InstallOptions): boolean {
  const hooks = hooksObject(settings);
  const events: readonly string[] = HOOK_EVENTS;
  const stale = Object.entries(hooks).some(
    ([event, groups]) => !events.includes(event) && groups.some((group) => (group.hooks ?? []).some(isOurs)),
  );
  return !stale && HOOK_EVENTS.every((event) =>
    (hooks[event] ?? []).some((group) =>
      (group.hooks ?? []).some((handler) => {
        if (!isOurs(handler)) return false;
        const expected = ourHandler(event, options);
        return (
          handler.command === expected.command &&
          JSON.stringify(handler.args) === JSON.stringify(expected.args) &&
          handler['timeout'] === expected['timeout']
        );
      }),
    ),
  );
}

export function anyHooksInstalled(settings: ClaudeSettings): boolean {
  return Object.values(hooksObject(settings)).some((groups) =>
    groups.some((group) => (group.hooks ?? []).some(isOurs)),
  );
}

export interface StatusLineConfig {
  type: string;
  command: string;
  [key: string]: unknown;
}

function forwardSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}

export function statuslineCommand(nodePath: string, hookPath: string): string {
  return `"${forwardSlashes(nodePath)}" "${forwardSlashes(hookPath)}" statusline`;
}

export function currentStatusline(settings: ClaudeSettings): StatusLineConfig | null {
  const value = settings['statusLine'];
  if (!value || typeof value !== 'object') return null;
  const config = value as StatusLineConfig;
  return typeof config.command === 'string' ? config : null;
}

export function statuslineInstalled(settings: ClaudeSettings): boolean {
  return currentStatusline(settings)?.command.includes(HOOK_SCRIPT_NAME) ?? false;
}

/** Installs the wrapper. Returns the foreign statusline that was replaced, if any, so it can be chained. */
export function installStatusline(
  settings: ClaudeSettings,
  nodePath: string,
  hookPath: string,
): { settings: ClaudeSettings; previous: StatusLineConfig | null } {
  const existing = currentStatusline(settings);
  const previous = existing && !existing.command.includes(HOOK_SCRIPT_NAME) ? existing : null;
  const base = previous ?? existing;
  const next: StatusLineConfig = { ...(base ?? {}), type: 'command', command: statuslineCommand(nodePath, hookPath) };
  return { settings: { ...settings, statusLine: next }, previous };
}

export function uninstallStatusline(settings: ClaudeSettings, previous: StatusLineConfig | null): ClaudeSettings {
  if (!statuslineInstalled(settings)) return settings;
  const result = { ...settings };
  if (previous) result['statusLine'] = previous;
  else delete result['statusLine'];
  return result;
}
