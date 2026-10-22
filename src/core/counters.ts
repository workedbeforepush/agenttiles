// The header counters: which session states each one counts. The renderer filters tiles by the same groups.
import type { SessionState } from './types';

export type StatusFilter = 'working' | 'waiting' | 'done';

/** `unknown` belongs to no counter, so any active filter hides it. */
export const FILTER_STATES: Record<StatusFilter, SessionState[]> = {
  working: ['working', 'compacting', 'shell'],
  waiting: ['needsApproval', 'needsInput', 'error', 'limitHit'],
  done: ['done', 'idle'],
};

export function countStates(states: SessionState[]): Record<StatusFilter, number> {
  const count = (filter: StatusFilter): number => states.filter((s) => FILTER_STATES[filter].includes(s)).length;
  return { working: count('working'), waiting: count('waiting'), done: count('done') };
}
