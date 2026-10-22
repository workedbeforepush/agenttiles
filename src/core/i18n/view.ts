// Texts of tile fields that the core leaves as keys or structured values.
import type { Activity, StateLabel } from '../types';
import type { Translate } from './index';

export function stateText(label: StateLabel, t: Translate): string {
  return t(`state.${label}`);
}

export function activityText(activity: Activity | null, t: Translate): string | null {
  if (activity === null) return null;
  switch (activity.kind) {
    case 'text':
      return activity.text;
    case 'failed':
      return t('activity.failed', { text: activity.text });
    case 'thinking':
      return t('activity.thinking');
    case 'planReady':
      return t('activity.planReady');
  }
}

/** A duration as "45s", "12m", "2h 5m" or "1d 4h". */
export function durationText(ms: number, t: Translate): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return t('duration.seconds', { s: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('duration.minutes', { m: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('duration.hoursMinutes', { h: hours, m: minutes % 60 });
  return t('duration.daysHours', { d: Math.floor(hours / 24), h: hours % 24 });
}
