// OS toasts for state transitions that need the user's attention.
import { Notification } from 'electron';
import type { SessionState, Settings, TileView } from '../core/types';
import { clipText } from '../core/tools';
import type { Transition } from './store';
import type { Nudge } from './attention';
import { APP_ICON_PNG } from './appId';
import { log } from './log';

const TOAST_STATES = new Set<SessionState>(['needsApproval', 'needsInput', 'done', 'error', 'limitHit']);
const PER_SESSION_GAP_MS = 5000;
const BODY_MAX = 180;

function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Title and body per state: what happened in the title, the detail that matters in the body. */
export function toastText(tile: TileView): { title: string; body: string } {
  switch (tile.state) {
    case 'needsApproval':
      return {
        title: `${tile.name} · needs approval`,
        body: clipText(tile.pending?.summary ?? tile.activity ?? 'A tool call waits for your approval.', BODY_MAX),
      };
    case 'needsInput': {
      const questions = tile.pending?.questions;
      const more = questions && questions.length > 1 ? ` (+${questions.length - 1} more)` : '';
      return {
        title: `${tile.name} · ${tile.stateLabel}`,
        body: clipText(`${questions?.[0]?.question ?? tile.activity ?? 'Claude is waiting for your answer.'}${more}`, BODY_MAX),
      };
    }
    case 'done': {
      const took = tile.lastTurnMs !== null ? `Took ${duration(tile.lastTurnMs)}` : 'Turn finished';
      const reply = tile.lastAssistant ? ` · ${tile.lastAssistant}` : '';
      return { title: `${tile.name} · ready`, body: clipText(`${took}${reply}`, BODY_MAX) };
    }
    case 'limitHit':
      return {
        title: `${tile.name} · rate limit reached`,
        body: clipText(tile.activity ?? 'Claude stopped at the usage limit.', BODY_MAX),
      };
    case 'error':
      return { title: `${tile.name} · error`, body: clipText(tile.activity ?? 'The turn failed.', BODY_MAX) };
    default:
      return { title: tile.name, body: tile.stateLabel };
  }
}

/** Toast text of a reminder or context warning. */
export function nudgeText(nudge: Nudge, now: number): { title: string; body: string } {
  const { tile } = nudge;
  if (nudge.kind === 'contextFull') {
    return {
      title: `${tile.name} · context ${Math.round(tile.contextPct ?? 0)}% full`,
      body: 'Claude Code compacts the conversation soon. Run /compact at a good point, or /clear for a fresh start.',
    };
  }
  const { body } = toastText(tile);
  return { title: `${tile.name} · still waiting (${duration(now - tile.stateSince)})`, body };
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
      // Silent: ccdash plays its own per-state cue, a second sound from Windows would double it.
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
