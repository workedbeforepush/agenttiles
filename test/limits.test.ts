import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LimitsCache } from '../src/main/limits';

const dir = mkdtempSync(join(tmpdir(), 'ccdash-limits-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('LimitsCache', () => {
  const nowSec = Math.floor(Date.now() / 1000);

  it('keeps values whose window has not reset yet, with their observation time', () => {
    const cache = new LimitsCache(dir);
    const fiveHour = { usedPct: 41, resetsAt: nowSec + 3600, observedAt: Date.now() - 14 * 3600_000 };
    cache.save({ fiveHour, sevenDay: null });
    expect(cache.load()).toEqual({ fiveHour, sevenDay: null });
  });

  it('drops values after their reset and values without observation time', () => {
    const cache = new LimitsCache(dir);
    cache.save({
      fiveHour: { usedPct: 80, resetsAt: nowSec - 1, observedAt: Date.now() },
      sevenDay: { usedPct: 20, resetsAt: nowSec + 3600 } as never,
    });
    expect(cache.load()).toEqual({ fiveHour: null, sevenDay: null });
  });

  it('survives a damaged file', () => {
    writeFileSync(join(dir, 'limits.json'), '{"fiveH');
    expect(new LimitsCache(dir).load()).toEqual({ fiveHour: null, sevenDay: null });
  });
});
