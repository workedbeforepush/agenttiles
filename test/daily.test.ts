import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DailyStats } from '../src/main/daily';

const dir = mkdtempSync(join(tmpdir(), 'ccdash-daily-'));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('DailyStats', () => {
  it('counts sessions, prompts, working and waiting time and today-only cost', () => {
    const stats = new DailyStats(dir);
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    stats.sawSession('a');
    stats.sawSession('a');
    stats.sawSession('b');
    stats.turn('web');
    stats.turn('web');
    stats.addStateTime('working', 60_000, 'web');
    stats.addStateTime('compacting', 1000, 'web');
    stats.addStateTime('needsApproval', 5000, 'api');
    stats.addStateTime('done', 99_000, 'api');
    stats.recordCost('a', 2, startOfToday + 1, 'web');
    stats.recordCost('a', 3, startOfToday + 1, 'web');
    stats.recordCost('old', 10, startOfToday - 1, 'api');
    stats.recordCost('old', 12, startOfToday - 1, 'api');
    expect(stats.view()).toEqual({ sessions: 2, turns: 2, workingMs: 61_000, waitingMs: 5000, costUsd: 5 });
    expect(stats.stats(7).days.at(-1)?.projects).toEqual({
      web: { costUsd: 3, turns: 2, workingMs: 61_000, waitingMs: 0 },
      api: { costUsd: 2, turns: 0, workingMs: 0, waitingMs: 5000 },
    });
    stats.flush();
  });

  it('persists across instances', () => {
    const first = new DailyStats(dir);
    first.turn('web');
    first.flush();
    expect(new DailyStats(dir).view().turns).toBe(3);
  });

  it('archives a finished day per project and lists empty days', () => {
    const own = mkdtempSync(join(tmpdir(), 'ccdash-history-'));
    try {
      let now = new Date(2026, 9, 20, 23, 0).getTime();
      const stats = new DailyStats(own, () => now);
      stats.turn('web');
      stats.recordCost('s', 4, now - 1000, 'web');
      now = new Date(2026, 9, 22, 9, 0).getTime();
      stats.recordCost('s', 5, 0, 'web');
      const view = stats.stats(3);
      expect(view.days.map((d) => d.date)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
      expect(view.days[0]?.projects).toEqual({ web: { costUsd: 4, turns: 1, workingMs: 0, waitingMs: 0 } });
      expect(view.days[1]?.projects).toEqual({});
      expect(view.days[2]?.projects['web']?.costUsd).toBe(1);
      expect(view.recordedSince).toBe('2026-10-20');
      // The archive survives a restart.
      expect(new DailyStats(own, () => now).stats(3).days[0]?.projects['web']?.turns).toBe(1);
      stats.flush();
    } finally {
      rmSync(own, { recursive: true, force: true });
    }
  });
});
