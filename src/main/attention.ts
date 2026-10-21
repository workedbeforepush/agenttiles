// Nudges beyond state changes: reminders while a session keeps waiting, and a warning when its context fills up.
import type { SessionState, Settings, TileView } from '../core/types';

export interface Nudge {
  tile: TileView;
  kind: 'reminder' | 'contextFull';
}

const WAITING = new Set<SessionState>(['needsApproval', 'needsInput']);
/** The context warning re-arms once usage dropped this far below the threshold (after a compact or /clear). */
const REARM_GAP_PCT = 10;

export class Attention {
  /** Per waiting session: the wait it belongs to (state start) and how many reminders were sent for it. */
  private readonly reminded = new Map<string, { since: number; count: number }>();
  private readonly contextWarned = new Set<string>();
  private readonly seen = new Set<string>();

  check(tiles: TileView[], now: number, settings: Pick<Settings, 'reminderMin' | 'contextWarnPct'>): Nudge[] {
    const nudges: Nudge[] = [];
    const live = new Set(tiles.map((t) => t.sessionId));
    for (const map of [this.reminded, this.contextWarned, this.seen]) {
      for (const id of [...map.keys()]) if (!live.has(id)) map.delete(id);
    }
    for (const tile of tiles) {
      const firstSight = !this.seen.has(tile.sessionId);
      this.seen.add(tile.sessionId);
      // Sessions already waiting or full when AgentTiles starts are marked, not announced: no burst of toasts on start.
      if (this.remind(tile, now, settings.reminderMin, firstSight)) nudges.push({ tile, kind: 'reminder' });
      if (this.contextFull(tile, settings.contextWarnPct) && !firstSight) nudges.push({ tile, kind: 'contextFull' });
    }
    return nudges;
  }

  private remind(tile: TileView, now: number, minutes: number, firstSight: boolean): boolean {
    if (minutes <= 0 || !WAITING.has(tile.state)) {
      this.reminded.delete(tile.sessionId);
      return false;
    }
    const due = Math.floor((now - tile.stateSince) / (minutes * 60_000));
    let entry = this.reminded.get(tile.sessionId);
    if (!entry || entry.since !== tile.stateSince) {
      entry = { since: tile.stateSince, count: firstSight ? due : 0 };
      this.reminded.set(tile.sessionId, entry);
    }
    if (due <= entry.count) return false;
    entry.count = due;
    return true;
  }

  /** True once when the context crosses the threshold; re-armed when it drops clearly below again. */
  private contextFull(tile: TileView, threshold: number): boolean {
    const pct = tile.contextPct;
    if (threshold <= 0 || pct === null) return false;
    if (pct < threshold - REARM_GAP_PCT) this.contextWarned.delete(tile.sessionId);
    if (pct < threshold || this.contextWarned.has(tile.sessionId)) return false;
    this.contextWarned.add(tile.sessionId);
    return true;
  }
}
