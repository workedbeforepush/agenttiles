import { describe, expect, it } from 'vitest';
import { countStates, FILTER_STATES } from '../src/core/counters';
import type { SessionState } from '../src/core/types';

describe('header counters', () => {
  it('counts every state except unknown in exactly one counter', () => {
    const states: SessionState[] = [
      'working',
      'needsApproval',
      'needsInput',
      'done',
      'idle',
      'error',
      'limitHit',
      'compacting',
      'shell',
      'unknown',
    ];
    expect(countStates(states)).toEqual({ working: 3, waiting: 4, done: 2 });
    const grouped = Object.values(FILTER_STATES).flat();
    expect(new Set(grouped).size).toBe(grouped.length);
  });
});
