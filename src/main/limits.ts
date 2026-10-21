// Last known rate limits, kept across restarts so the header is filled before the next statusline update.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RateLimit } from '../core/types';

export interface Limits {
  fiveHour: RateLimit | null;
  sevenDay: RateLimit | null;
}

function valid(value: unknown, nowSec: number): RateLimit | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v['usedPct'] !== 'number' || typeof v['resetsAt'] !== 'number' || typeof v['observedAt'] !== 'number') {
    return null;
  }
  // After the reset the stored value is wrong; show nothing until Claude Code reports the new window.
  if (v['resetsAt'] <= nowSec) return null;
  // Kept with its observation time: the header marks it as stale instead of passing it off as current.
  return { usedPct: v['usedPct'], resetsAt: v['resetsAt'], observedAt: v['observedAt'] };
}

export class LimitsCache {
  private readonly path: string;

  constructor(dir: string) {
    this.path = join(dir, 'limits.json');
  }

  load(): Limits {
    const nowSec = Date.now() / 1000;
    if (!existsSync(this.path)) return { fiveHour: null, sevenDay: null };
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, unknown> | null;
      return { fiveHour: valid(raw?.['fiveHour'], nowSec), sevenDay: valid(raw?.['sevenDay'], nowSec) };
    } catch {
      return { fiveHour: null, sevenDay: null };
    }
  }

  save(limits: Limits): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(limits));
    renameSync(tmp, this.path);
  }
}
