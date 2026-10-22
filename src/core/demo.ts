// Invented sessions for the README screenshots and the tour: realistic, but no real project names, paths or costs.
import type { Activity, HistoryPoint, PendingPermission, SessionState, Snapshot, StateLabel, TileView } from './types';
import { toolDiff } from './diff';
import { suggestionLabel } from './permissions';
import { countStates } from './counters';

export const MIN = 60_000;
/** A plausible state history over the last 30 minutes, ending in `last`. */
function history(now: number, steps: SessionState[], last: SessionState, since: number): HistoryPoint[] {
  const start = now - 30 * MIN;
  const span = (since - start) / Math.max(1, steps.length);
  return [...steps.map((state, i) => ({ state, at: start + i * span })), { state: last, at: since }];
}

interface TileSpec {
  id: string;
  name: string;
  project: string;
  state: SessionState;
  sinceMin: number;
  label?: StateLabel;
  activity?: Activity | null;
  /** A background session (`claude --bg`). */
  jobId?: string;
  model?: string;
  branch: string;
  added: number;
  removed: number;
  costUsd: number;
  contextPct: number;
  recentTools?: string[];
  turnMin?: number | null;
  lastTurnMin?: number | null;
  lastPrompt: string;
  lastAssistant?: string | null;
  pending?: PendingPermission | null;
  subagents?: string[];
  tasks?: { subject: string; done: boolean }[];
  steps: SessionState[];
  pinned?: boolean;
  pr?: { number: number; reviewState: string } | null;
}

function tile(now: number, s: TileSpec): TileView {
  const since = now - s.sinceMin * MIN;
  const tasks = s.tasks ?? [];
  return {
    sessionId: s.id,
    pid: 1000 + s.id.charCodeAt(0),
    cwd: `C:\\dev\\${s.project}`,
    project: s.project,
    name: s.name,
    state: s.state,
    label: s.label ?? s.state,
    stateSince: since,
    activity: s.activity ?? null,
    model: s.model ?? 'Opus 5.5',
    subagents: s.subagents?.length ?? 0,
    tasksDone: tasks.filter((t) => t.done).length,
    tasksTotal: tasks.length,
    costUsd: s.costUsd,
    contextPct: s.contextPct,
    hooks: true,
    pinned: s.pinned ?? false,
    startedAt: now - 90 * MIN,
    lastPrompt: s.lastPrompt,
    lastAssistant: s.lastAssistant ?? null,
    pending: s.pending ?? null,
    version: '2.1.306',
    jobId: s.jobId ?? null,
    recentTools: s.recentTools ?? [],
    turnStartedAt: s.turnMin != null ? now - s.turnMin * MIN : null,
    lastTurnMs: s.lastTurnMin != null ? s.lastTurnMin * MIN : null,
    history: history(now, s.steps, s.state, since),
    git: {
      branch: s.branch,
      worktree: null,
      pr: s.pr ? { number: s.pr.number, url: null, reviewState: s.pr.reviewState } : null,
      linesAdded: s.added,
      linesRemoved: s.removed,
    },
    tasks,
    subagentTypes: s.subagents ?? [],
  };
}

const EDIT_INPUT = {
  file_path: 'C:\\dev\\api-gateway\\src\\middleware\\auth.ts',
  old_string: [
    'export function verifyToken(token: string): Claims {',
    '  const claims = jwt.verify(token, SECRET) as Claims;',
    '  return claims;',
    '}',
  ].join('\n'),
  new_string: [
    'export function verifyToken(token: string): Claims {',
    '  const { kid } = jwt.decode(token, { complete: true })?.header ?? {};',
    '  const key = keyRing.get(kid);',
    "  if (!key) throw new AuthError('unknown signing key');",
    '  return jwt.verify(token, key, { algorithms: [\'RS256\'] }) as Claims;',
    '}',
  ].join('\n'),
};

const SUGGESTIONS = [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }];

export function approvalPending(): PendingPermission {
  return {
    id: 'demo-edit',
    toolName: 'Edit',
    summary: 'Edit: auth.ts',
    toolInput: EDIT_INPUT,
    questions: null,
    diff: toolDiff('Edit', EDIT_INPUT, null),
    plan: null,
    alwaysLabel: suggestionLabel(SUGGESTIONS),
  };
}

const QUESTION: PendingPermission = {
  id: 'demo-question',
  toolName: 'AskUserQuestion',
  summary: 'AskUserQuestion',
  toolInput: {},
  questions: [
    {
      question: 'Which store should the analytics events go to?',
      header: 'Storage',
      multiSelect: false,
      options: [
        { label: 'ClickHouse', description: 'Columnar, fast aggregations, one more service to run' },
        { label: 'Postgres + TimescaleDB', description: 'Reuses the existing database, simpler operations' },
        { label: 'Parquet on S3', description: 'Cheapest storage, queries through DuckDB' },
      ],
    },
    {
      question: 'Backfill the last 90 days?',
      header: 'Backfill',
      multiSelect: false,
      options: [
        { label: 'Yes', description: 'About 40 minutes of batch jobs' },
        { label: 'No', description: 'Start collecting from today' },
      ],
    },
  ],
  diff: null,
  plan: null,
  alwaysLabel: null,
};

const PLAN: PendingPermission = {
  id: 'demo-plan',
  toolName: 'ExitPlanMode',
  summary: 'ExitPlanMode',
  toolInput: {},
  questions: null,
  diff: null,
  plan: [
    '# Dark mode for the mobile app',
    '',
    '- Add a `ThemeProvider` with light, dark and system modes',
    '- Move hard-coded colours in 14 screens to design tokens',
    '- Persist the choice in `AsyncStorage`',
    '- Snapshot tests for both themes',
  ].join('\n'),
  alwaysLabel: null,
};

export interface DemoProgress {
  /** The auth tile's edit was allowed: "approve?" becomes working. */
  approved: boolean;
  /** The analytics question was answered: the tile goes back to work. */
  answered: boolean;
}

/** The dashboard in a given step of the demo story. */
export function snapshot(now: number, progress: DemoProgress = { approved: false, answered: false }): Snapshot {
  const { approved, answered } = progress;
  const tiles: TileView[] = [
    approved
      ? tile(now, {
          id: 'a1',
          name: 'Rotate JWT signing keys',
          project: 'api-gateway',
          state: 'working',
          sinceMin: 0,
          activity: { kind: 'text', text: 'Edit: auth.ts' },
          branch: 'feature/jwt-rotation',
          added: 184,
          removed: 42,
          costUsd: 3.12,
          contextPct: 46,
          recentTools: ['Read: keyring.ts', 'Grep: verifyToken', 'Edit: auth.ts'],
          turnMin: 6,
          lastPrompt: 'Support key rotation: tokens carry a kid, verify against the key ring.',
          steps: ['working', 'needsApproval', 'working'],
          pinned: true,
        })
      : tile(now, {
          id: 'a1',
          name: 'Rotate JWT signing keys',
          project: 'api-gateway',
          state: 'needsApproval',
          sinceMin: 2,
          branch: 'feature/jwt-rotation',
          added: 184,
          removed: 42,
          costUsd: 3.12,
          contextPct: 46,
          recentTools: ['Read: keyring.ts', 'Grep: verifyToken'],
          turnMin: 6,
          lastPrompt: 'Support key rotation: tokens carry a kid, verify against the key ring.',
          pending: approvalPending(),
          steps: ['working', 'needsApproval', 'working'],
          pinned: true,
        }),
    tile(now, {
      id: 'b2',
      name: 'Checkout flow e2e tests',
      project: 'web-shop',
      state: 'working',
      sinceMin: 4,
      activity: { kind: 'text', text: 'Bash: npx playwright test checkout --project=chromium' },
      model: 'Sonnet 5.5',
      branch: 'test/checkout-e2e',
      added: 312,
      removed: 18,
      costUsd: 1.87,
      contextPct: 31,
      recentTools: ['Write: checkout.spec.ts', 'Edit: fixtures.ts', 'Bash: npx playwright test checkout --project=chromium'],
      turnMin: 9,
      lastPrompt: 'Cover the checkout flow end to end, including a declined card.',
      tasks: [
        { subject: 'Happy path', done: true },
        { subject: 'Declined card', done: true },
        { subject: 'Coupon codes', done: false },
      ],
      steps: ['idle', 'working', 'needsApproval', 'working'],
    }),
    answered
      ? tile(now, {
          id: 'c3',
          name: 'Analytics event pipeline',
          project: 'data-pipeline',
          state: 'working',
          sinceMin: 0,
          activity: { kind: 'text', text: 'Write: pipeline/clickhouse_sink.py' },
          branch: 'main',
          added: 48,
          removed: 0,
          costUsd: 0.71,
          contextPct: 21,
          recentTools: ['Write: pipeline/clickhouse_sink.py'],
          turnMin: 3,
          lastPrompt: 'Design an event pipeline for product analytics.',
          steps: ['idle', 'working', 'needsInput'],
        })
      : tile(now, {
      id: 'c3',
      name: 'Analytics event pipeline',
      project: 'data-pipeline',
      state: 'needsInput',
      sinceMin: 1,
      activity: { kind: 'text', text: 'Which store should the analytics events go to?' },
      branch: 'main',
      added: 0,
      removed: 0,
      costUsd: 0.64,
      contextPct: 18,
      turnMin: 3,
      lastPrompt: 'Design an event pipeline for product analytics.',
      pending: QUESTION,
      steps: ['idle', 'working'],
    }),
    tile(now, {
      id: 'd4',
      name: 'Fix flaky Windows CI',
      project: 'infra',
      state: 'done',
      sinceMin: 3,
      branch: 'fix/ci-windows-paths',
      added: 27,
      removed: 11,
      costUsd: 0.92,
      contextPct: 22,
      lastTurnMin: 11,
      lastPrompt: 'The Windows job fails about every third run. Find out why.',
      lastAssistant:
        '**Fixed.** The cache key used `\\` paths on Windows, so restores missed and two jobs raced on the same temp dir. Normalised the key and gave each job its own `RUNNER_TEMP`. 20 runs green in a row.',
      steps: ['working', 'working', 'done'],
      pr: { number: 482, reviewState: 'approved' },
    }),
    tile(now, {
      id: 'e5',
      name: 'Migrate to Svelte 5 runes',
      project: 'design-system',
      state: 'working',
      sinceMin: 12,
      activity: { kind: 'text', text: 'Agent: migrate Button, Dialog and Tabs' },
      branch: 'chore/svelte5-runes',
      added: 1240,
      removed: 980,
      costUsd: 6.45,
      contextPct: 58,
      recentTools: ['Glob: src/**/*.svelte', 'Agent: migrate Button, Dialog and Tabs'],
      turnMin: 12,
      lastPrompt: 'Migrate all components from stores to runes.',
      subagents: ['general-purpose', 'general-purpose'],
      tasks: [
        { subject: 'Button', done: true },
        { subject: 'Dialog', done: true },
        { subject: 'Tabs', done: false },
        { subject: 'Select', done: false },
        { subject: 'Toast', done: false },
      ],
      steps: ['working', 'working', 'working'],
    }),
    tile(now, {
      id: 'f6',
      name: 'Dark mode',
      project: 'mobile-app',
      state: 'needsInput',
      sinceMin: 5,
      label: 'planReady',
      activity: { kind: 'planReady' },
      model: 'Opus 5.5',
      branch: 'feature/dark-mode',
      added: 0,
      removed: 0,
      costUsd: 1.21,
      contextPct: 27,
      turnMin: 7,
      lastPrompt: 'Plan dark mode for the app. Do not change code yet.',
      pending: PLAN,
      steps: ['idle', 'working'],
    }),
    tile(now, {
      id: 'g7',
      name: 'Search across the monorepo',
      jobId: '4f2a9c1e',
      project: 'platform',
      state: 'compacting',
      sinceMin: 0,
      branch: 'main',
      added: 64,
      removed: 9,
      costUsd: 4.88,
      contextPct: 91,
      recentTools: ['Grep: featureFlag(', 'Read: flags.ts'],
      turnMin: 15,
      lastPrompt: 'List every feature flag that is still read anywhere.',
      steps: ['working', 'working', 'working'],
    }),
    tile(now, {
      id: 'h8',
      name: 'Release notes v2.4',
      project: 'docs',
      state: 'idle',
      sinceMin: 24,
      model: 'Haiku 5.5',
      branch: 'release/2.4',
      added: 96,
      removed: 4,
      costUsd: 0.18,
      contextPct: 12,
      lastPrompt: 'Draft the release notes from the merged PRs since v2.3.',
      lastAssistant: 'Draft is in `CHANGELOG.md`: 9 features, 14 fixes, 2 breaking changes with migration notes.',
      steps: ['working', 'done'],
    }),
  ];
  return {
    tiles,
    ended: [
      {
        sessionId: 'i9',
        cwd: 'C:\\dev\\web-shop',
        project: 'web-shop',
        name: 'Product page performance',
        endedAt: now - 42 * MIN,
        lastPrompt: 'The product page takes 4 seconds to load on mobile. Make it fast.',
        lastAssistant: 'Largest contentful paint is down from 4.1 s to 1.3 s: images are lazy-loaded and resized, and the reviews widget loads after the page.',
      },
    ],
    header: {
      ...countStates(tiles.map((t) => t.state)),
      fiveHour: { usedPct: 62, resetsAt: Math.round((now + 112 * MIN) / 1000), observedAt: now - MIN },
      sevenDay: { usedPct: 38, resetsAt: Math.round((now + 3 * 24 * 60 * MIN) / 1000), observedAt: now - MIN },
      fiveHourEta: null,
      today: { sessions: 8, turns: 46, workingMs: 192 * MIN, waitingMs: 14 * MIN, costUsd: 19.27 },
    },
  };
}
