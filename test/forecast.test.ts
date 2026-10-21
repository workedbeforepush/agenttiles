import { describe, expect, it } from 'vitest';
import { addSample, limitEta, type UsageSample } from '../src/core/forecast';

const MIN = 60_000;

function series(points: [number, number][]): UsageSample[] {
  return points.reduce<UsageSample[]>((acc, [minute, usedPct]) => addSample(acc, { at: minute * MIN, usedPct }), []);
}

describe('limit forecast', () => {
  it('extrapolates linearly over the window', () => {
    // 10 % in 10 minutes -> 50 % left -> 50 more minutes after minute 10.
    const samples = series([[0, 40], [5, 45], [10, 50]]);
    expect(limitEta(samples, null)).toBe(60 * MIN);
  });

  it('returns null when the limit is only reached after the reset', () => {
    const samples = series([[0, 40], [10, 50]]);
    expect(limitEta(samples, 30 * MIN)).toBeNull();
  });

  it('needs at least five minutes of data and rising usage', () => {
    expect(limitEta(series([[0, 40], [3, 45]]), null)).toBeNull();
    expect(limitEta(series([[0, 40], [10, 40]]), null)).toBeNull();
  });

  it('starts a new series after a reset and drops samples older than 30 minutes', () => {
    expect(series([[0, 80], [10, 90], [11, 2]])).toEqual([{ at: 11 * MIN, usedPct: 2 }]);
    expect(series([[0, 10], [20, 20], [40, 30]]).map((s) => s.at / MIN)).toEqual([20, 40]);
  });
});
