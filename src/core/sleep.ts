// Periods the machine slept: working and waiting time counts only while it was awake.

export interface Sleep {
  from: number;
  to: number;
}

/** Milliseconds of [from, to] that fall into the given sleeps. */
export function sleptWithin(sleeps: readonly Sleep[], from: number, to: number): number {
  return sleeps.reduce((sum, s) => sum + Math.max(0, Math.min(to, s.to) - Math.max(from, s.from)), 0);
}
