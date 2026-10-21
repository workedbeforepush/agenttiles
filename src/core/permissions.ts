// Claude Code's permission suggestions ("always allow" in its dialog) and their labels for the tile.

/** A permission update entry as Claude Code sends and accepts it; passed through unchanged. */
export type PermissionUpdate = Record<string, unknown>;

const MAX_SUGGESTIONS = 10;

/** The suggestions of a PermissionRequest input: plain objects with a string `type`, anything else is dropped. */
export function suggestionsOf(input: Record<string, unknown>): PermissionUpdate[] {
  const raw = input['permission_suggestions'];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is PermissionUpdate => !!s && typeof s === 'object' && !Array.isArray(s) && typeof (s as PermissionUpdate)['type'] === 'string')
    .slice(0, MAX_SUGGESTIONS);
}

const WHERE: Record<string, string> = {
  session: 'this session',
  localSettings: 'this project',
  projectSettings: 'this project (shared)',
  userSettings: 'all projects',
};

function where(update: PermissionUpdate): string {
  const destination = update['destination'];
  return typeof destination === 'string' ? (WHERE[destination] ?? destination) : 'this session';
}

function rules(update: PermissionUpdate): string {
  const list = Array.isArray(update['rules']) ? (update['rules'] as unknown[]) : [];
  return list
    .map((r) => {
      const rule = r && typeof r === 'object' ? (r as Record<string, unknown>) : {};
      const tool = typeof rule['toolName'] === 'string' ? rule['toolName'] : '?';
      return typeof rule['ruleContent'] === 'string' ? `${tool}(${rule['ruleContent']})` : tool;
    })
    .join(', ');
}

/** What allowing with these suggestions does, in one line; null when there is nothing to offer. */
export function suggestionLabel(updates: PermissionUpdate[]): string | null {
  const parts = updates.flatMap((u): string[] => {
    switch (u['type']) {
      case 'addRules':
        return u['behavior'] === 'allow' ? [`always allow ${rules(u)} in ${where(u)}`] : [];
      case 'setMode':
        return u['mode'] === 'acceptEdits' ? [`allow all edits in ${where(u)}`] : [`switch to ${String(u['mode'])} mode`];
      case 'addDirectories': {
        const dirs = Array.isArray(u['directories']) ? (u['directories'] as unknown[]).join(', ') : '';
        return [`allow access to ${dirs} in ${where(u)}`];
      }
      default:
        return [];
    }
  });
  if (parts.length === 0) return null;
  const text = parts.join(' + ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
