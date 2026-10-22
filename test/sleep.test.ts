import { describe, expect, it } from 'vitest';
import { sleptWithin } from '../src/core/sleep';

describe('time slept', () => {
  const sleeps = [
    { from: 100, to: 200 },
    { from: 500, to: 800 },
  ];

  it('counts only the part of each sleep inside the interval', () => {
    expect(sleptWithin(sleeps, 0, 1000)).toBe(400);
    expect(sleptWithin(sleeps, 150, 600)).toBe(150);
    expect(sleptWithin(sleeps, 200, 500)).toBe(0);
    expect(sleptWithin([], 0, 1000)).toBe(0);
  });
});
