// Recently ended sessions, kept as muted tiles to resume or fork: the list logic and the file format of ended.json.
import type { EndedTileView } from './types';

/** How long an ended session stays on the dashboard unless the user removes it. */
export const ENDED_KEEP_MS = 24 * 3_600_000;
/** Prompt and reply are kept short: the tile shows a few lines, the file is rewritten on every change. */
export const ENDED_TEXT_MAX = 600;

/** Adds the entry, replacing an older one of the same session; most recently ended first. */
export function addEnded(list: EndedTileView[], entry: EndedTileView): EndedTileView[] {
  return [entry, ...list.filter((e) => e.sessionId !== entry.sessionId)].sort((a, b) => b.endedAt - a.endedAt);
}

/** Entries that have not expired at `now`. */
export function unexpired(list: EndedTileView[], now: number): EndedTileView[] {
  return list.filter((e) => now - e.endedAt < ENDED_KEEP_MS);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The entries of a parsed ended.json; malformed and expired entries are left out. */
export function parseEnded(raw: unknown, now: number): EndedTileView[] {
  const sessions = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)['sessions'] : null;
  if (!Array.isArray(sessions)) return [];
  let list: EndedTileView[] = [];
  for (const value of sessions as unknown[]) {
    if (!value || typeof value !== 'object') continue;
    const e = value as Record<string, unknown>;
    const sessionId = text(e['sessionId']);
    const cwd = text(e['cwd']);
    const project = text(e['project']);
    const name = text(e['name']);
    const endedAt = e['endedAt'];
    if (!sessionId || !cwd || !project || !name || typeof endedAt !== 'number' || !Number.isFinite(endedAt)) continue;
    list = addEnded(list, {
      sessionId,
      cwd,
      project,
      name,
      // A clock set back must not keep an entry forever.
      endedAt: Math.min(endedAt, now),
      lastPrompt: text(e['lastPrompt']),
      lastAssistant: text(e['lastAssistant']),
    });
  }
  return unexpired(list, now);
}
