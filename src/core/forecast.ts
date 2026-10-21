// Linear forecast of when the 5 hour rate limit is reached, from recent usage samples.

export interface UsageSample {
  at: number;
  usedPct: number;
}

export const FORECAST_WINDOW_MS = 30 * 60 * 1000;
const MIN_SPAN_MS = 5 * 60 * 1000;

/** Keeps samples inside the forecast window; a reset (falling usage) starts a new series. */
export function addSample(samples: UsageSample[], sample: UsageSample): UsageSample[] {
  const last = samples.at(-1);
  if (last && sample.usedPct < last.usedPct) return [sample];
  if (last && last.usedPct === sample.usedPct && sample.at - last.at < 60_000) return samples;
  return [...samples, sample].filter((s) => s.at >= sample.at - FORECAST_WINDOW_MS);
}

/**
 * Epoch ms when usage reaches 100 % at the pace of the window, or null when there is too little data, usage is
 * flat, or the limit would only be reached after the reset.
 */
export function limitEta(samples: UsageSample[], resetsAtMs: number | null): number | null {
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last || last.at - first.at < MIN_SPAN_MS) return null;
  const rate = (last.usedPct - first.usedPct) / (last.at - first.at);
  if (rate <= 0) return null;
  const eta = last.at + (100 - last.usedPct) / rate;
  if (resetsAtMs !== null && eta >= resetsAtMs) return null;
  return Math.round(eta);
}
