// English messages: the source for every other locale. Shared texts live here, the rest per area in en/.
import { app } from './en/app';
import { header } from './en/header';
import { banner } from './en/banner';
import { tile } from './en/tile';
import { dialogs } from './en/dialogs';
import { newSession } from './en/newSession';
import { stats } from './en/stats';
import { settings } from './en/settings';
import { doctor } from './en/doctor';
import { tour } from './en/tour';
import { main } from './en/main';

export const en = {
  state: {
    working: 'working',
    needsApproval: 'approve?',
    needsInput: 'question',
    done: 'ready',
    idle: 'idle',
    error: 'error',
    limitHit: 'limit hit',
    compacting: 'compacting',
    shell: 'shell',
    unknown: 'unknown',
    question: 'question',
    planReady: 'plan ready',
    ended: 'ended',
  },
  activity: {
    thinking: 'thinking',
    planReady: 'Plan ready for review',
    failed: '{text} failed',
  },
  duration: {
    seconds: '{s}s',
    minutes: '{m}m',
    hoursMinutes: '{h}h {m}m',
    daysHours: '{d}d {h}h',
  },
  format: {
    costHint:
      'Token usage priced at API list prices, as reported by the Claude Code statusline. Not billed on a Claude subscription.',
    usageCostHint: 'Token usage from the session transcripts, priced at API list prices. Not billed on a Claude subscription.',
  },
  tray: {
    show: 'Show',
    settings: 'Settings',
    quit: 'Quit',
    update: 'Update to {version}…',
  },
  toast: {
    needsApproval: '{name} · needs approval',
    needsApprovalBody: 'A tool call waits for your approval.',
    needsInputBody: 'Claude is waiting for your answer.',
    moreQuestions: { one: '{text} (+{count} more)', other: '{text} (+{count} more)' },
    ready: '{name} · ready',
    took: 'Took {duration}',
    turnFinished: 'Turn finished',
    limitHit: '{name} · rate limit reached',
    limitHitBody: 'Claude stopped at the usage limit.',
    error: '{name} · error',
    errorBody: 'The turn failed.',
    titleWithState: '{name} · {state}',
    contextFull: '{name} · context {pct}% full',
    contextFullBody: 'Claude Code compacts the conversation soon. Run /compact at a good point, or /clear for a fresh start.',
    stillWaiting: '{name} · still waiting ({duration})',
    updateAvailable: 'AgentTiles {version} is available',
    updateAvailableBody: 'Click to update.',
  },
  app,
  header,
  banner,
  tile,
  dialogs,
  newSession,
  stats,
  settings,
  doctor,
  tour,
  main,
};
