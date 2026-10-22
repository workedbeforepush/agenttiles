// OS toasts for state transitions that need the user's attention.
import { Notification } from 'electron';
import type { SessionState, Settings, TileView } from '../core/types';
import { clipText } from '../core/tools';
import type { Translate } from '../core/i18n';
import { activityText, durationText, stateText } from '../core/i18n/view';
import { t as mainT } from './i18n';
import type { Transition } from './store';
import type { Nudge } from './attention';
import { APP_ICON_PNG } from './appId';
import { log } from './log';

const TOAST_STATES = new Set<SessionState>(['needsApproval', 'needsInput', 'done', 'error', 'limitHit']);
const PER_SESSION_GAP_MS = 5000;
const BODY_MAX = 180;

/** Title and body per state: what happened in the title, the detail that matters in the body. */
export function toastText(tile: TileView, t: Translate = mainT): { title: string; body: string } {
  const name = tile.name;
  const activity = activityText(tile.activity, t);
  switch (tile.state) {
    case 'needsApproval':
      return {
        title: t('toast.needsApproval', { name }),
        body: clipText(tile.pending?.summary ?? activity ?? t('toast.needsApprovalBody'), BODY_MAX),
      };
    case 'needsInput': {
      const questions = tile.pending?.questions;
      const text = questions?.[0]?.question ?? activity ?? t('toast.needsInputBody');
      const more = questions && questions.length > 1 ? t('toast.moreQuestions', { text, count: questions.length - 1 }) : text;
      return {
        title: t('toast.titleWithState', { name, state: stateText(tile.label, t) }),
        body: clipText(more, BODY_MAX),
      };
    }
    case 'done': {
      const took = tile.lastTurnMs !== null ? t('toast.took', { duration: durationText(tile.lastTurnMs, t) }) : t('toast.turnFinished');
      const reply = tile.lastAssistant ? ` · ${tile.lastAssistant}` : '';
      return { title: t('toast.ready', { name }), body: clipText(`${took}${reply}`, BODY_MAX) };
    }
    case 'limitHit':
      return { title: t('toast.limitHit', { name }), body: clipText(activity ?? t('toast.limitHitBody'), BODY_MAX) };
    case 'error':
      return { title: t('toast.error', { name }), body: clipText(activity ?? t('toast.errorBody'), BODY_MAX) };
    default:
      return { title: name, body: stateText(tile.label, t) };
  }
}

/** Toast text of a reminder or context warning. */
export function nudgeText(nudge: Nudge, now: number, t: Translate = mainT): { title: string; body: string } {
  const { tile } = nudge;
  if (nudge.kind === 'contextFull') {
    return {
      title: t('toast.contextFull', { name: tile.name, pct: Math.round(tile.contextPct ?? 0) }),
      body: t('toast.contextFullBody'),
    };
  }
  const { body } = toastText(tile, t);
  return { title: t('toast.stillWaiting', { name: tile.name, duration: durationText(now - tile.stateSince, t) }), body };
}

export class Notifier {
  private readonly last = new Map<string, number>();

  constructor(
    private readonly settings: () => Settings,
    private readonly windowFocused: () => boolean,
    private readonly onClick: (sessionId: string) => void,
  ) {}

  notify(transitions: Transition[]): void {
    const settings = this.settings();
    if (!settings.toasts || this.windowFocused() || !Notification.isSupported()) return;
    const now = Date.now();
    for (const { tile, state } of transitions) {
      if (!TOAST_STATES.has(state)) continue;
      if (now - (this.last.get(tile.sessionId) ?? 0) < PER_SESSION_GAP_MS) continue;
      this.last.set(tile.sessionId, now);
      const { title, body } = toastText(tile);
      // Silent: AgentTiles plays its own per-state cue, a second sound from Windows would double it.
      this.show(title, body, true, () => this.onClick(tile.sessionId));
    }
  }

  nudge(nudges: Nudge[]): void {
    if (!this.settings().toasts || this.windowFocused() || !Notification.isSupported()) return;
    const now = Date.now();
    for (const nudge of nudges) {
      const { title, body } = nudgeText(nudge, now);
      this.show(title, body, true, () => this.onClick(nudge.tile.sessionId));
    }
  }

  /** Plain informational toast, e.g. "not supported on this OS". */
  info(title: string, body: string): void {
    if (Notification.isSupported()) this.show(title, body, true);
  }

  private show(title: string, body: string, silent: boolean, onClick?: () => void): void {
    const toast = new Notification({ title, body, silent, icon: APP_ICON_PNG });
    if (onClick) toast.on('click', onClick);
    toast.on('failed', (_event, error) => log.warn(`toast failed: ${error}`));
    toast.show();
  }
}
