// Recently ended sessions, persisted in userData/ended.json so their tiles survive an AgentTiles restart.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EndedTileView } from '../core/types';
import { addEnded, parseEnded, unexpired } from '../core/ended';
import { log } from './log';

export class EndedSessions {
  private readonly path: string;
  private list: EndedTileView[];

  constructor(dir: string) {
    this.path = join(dir, 'ended.json');
    this.list = this.load();
  }

  private load(): EndedTileView[] {
    if (!existsSync(this.path)) return [];
    try {
      return parseEnded(JSON.parse(readFileSync(this.path, 'utf8')), Date.now());
    } catch (error) {
      // Only convenience is lost: the sessions stay resumable from New session.
      log.warn(`ended.json could not be read: ${(error as Error).message}`);
      return [];
    }
  }

  private save(): void {
    try {
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify({ sessions: this.list }));
      renameSync(tmp, this.path);
    } catch (error) {
      log.warn(`ended.json could not be written: ${(error as Error).message}`);
    }
  }

  add(entry: EndedTileView): void {
    this.list = addEnded(this.list, entry);
    this.save();
  }

  /** Removes the tile of a session (removed by the user, or the session runs again); false when there was none. */
  remove(sessionId: string): boolean {
    const next = this.list.filter((e) => e.sessionId !== sessionId);
    if (next.length === this.list.length) return false;
    this.list = next;
    this.save();
    return true;
  }

  ids(): string[] {
    return this.list.map((e) => e.sessionId);
  }

  get(sessionId: string): EndedTileView | undefined {
    return this.list.find((e) => e.sessionId === sessionId);
  }

  /** The tiles to show at `now`: expired ones and those `drop` names are removed for good. */
  current(now: number, drop: (entry: EndedTileView) => boolean): EndedTileView[] {
    const next = unexpired(this.list, now).filter((e) => !drop(e));
    if (next.length !== this.list.length) {
      this.list = next;
      this.save();
    }
    return this.list;
  }
}
