import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DailyStats } from '../src/main/daily';

const dir = mkdtempSync(join(tmpdir(), 'agenttiles-daily-'));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('DailyStats', () => {
  it('counts sessions, prompts, working and waiting time', () => {
    const stats = new DailyStats(dir);
    stats.sawSession('a');
    stats.sawSession('a');
    stats.sawSession('b');
    stats.turn('web');
    stats.turn('web');
    stats.addStateTime('working', 60_000, 'web');
    stats.addStateTime('compacting', 1000, 'web');
    stats.addStateTime('needsApproval', 5000, 'api');
    stats.addStateTime('done', 99_000, 'api');
    expect(stats.view()).toEqual({ sessions: 2, turns: 2, workingMs: 61_000, waitingMs: 5000 });
    expect(stats.days(7).at(-1)?.projects).toEqual({
      web: { turns: 2, workingMs: 61_000, waitingMs: 0 },
      api: { turns: 0, workingMs: 0, waitingMs: 5000 },
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
    const own = mkdtempSync(join(tmpdir(), 'agenttiles-history-'));
    try {
      let now = new Date(2026, 9, 20, 23, 0).getTime();
      const stats = new DailyStats(own, () => now);
      stats.turn('web');
      now = new Date(2026, 9, 22, 9, 0).getTime();
      stats.turn('web');
      const days = stats.days(3);
      expect(days.map((d) => d.date)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
      expect(days[0]?.projects).toEqual({ web: { turns: 1, workingMs: 0, waitingMs: 0 } });
      expect(days[1]?.projects).toEqual({});
      expect(days[2]?.projects['web']?.turns).toBe(1);
      expect(stats.firstDate()).toBe('2026-10-20');
      // The archive survives a restart.
      expect(new DailyStats(own, () => now).days(3)[0]?.projects['web']?.turns).toBe(1);
      stats.flush();
    } finally {
      rmSync(own, { recursive: true, force: true });
    }
  });
});
