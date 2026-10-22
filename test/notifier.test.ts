import { describe, expect, it, vi } from 'vitest';
import type { TileView } from '../src/core/types';

const shown = vi.hoisted(() => [] as { title: string; body: string }[]);
vi.mock('electron', () => ({
  Notification: class {
    static isSupported = (): boolean => true;
    constructor(private readonly options: { title: string; body: string }) {}
    on(): void {}
    show(): void {
      shown.push({ title: this.options.title, body: this.options.body });
    }
  },
}));
const { Notifier, toastText, updateText } = await import('../src/main/notifier');
const { DEFAULT_SETTINGS } = await import('../src/main/config');

function tile(extra: Partial<TileView>): TileView {
  return {
    sessionId: 's',
    pid: 1,
    cwd: '/x',
    project: 'x',
    name: 'Demo',
    state: 'done',
    label: 'done',
    stateSince: 0,
    activity: null,
    model: null,
    subagents: 0,
    tasksDone: 0,
    tasksTotal: 0,
    costUsd: null,
    contextPct: null,
    hooks: true,
    pinned: false,
    startedAt: 0,
    lastPrompt: null,
    lastAssistant: null,
    pending: null,
    version: null,
    jobId: null,
    recentTools: [],
    turnStartedAt: null,
    lastTurnMs: null,
    history: [],
    git: { branch: null, worktree: null, pr: null, linesAdded: null, linesRemoved: null },
    tasks: [],
    subagentTypes: [],
    ...extra,
  };
}

describe('toast text', () => {
  it('names the session and the state in the title and the detail in the body', () => {
    expect(
      toastText(
        tile({
          state: 'needsApproval',
          pending: { id: 'p', toolName: 'Bash', summary: 'Bash: rm -rf build', toolInput: {}, questions: null, diff: null, plan: null, alwaysLabel: null },
        }),
      ),
    ).toEqual({ title: 'Demo · needs approval', body: 'Bash: rm -rf build' });
    expect(toastText(tile({ state: 'done', lastTurnMs: 240_000, lastAssistant: 'All tests pass.' }))).toEqual({
      title: 'Demo · ready',
      body: 'Took 4m · All tests pass.',
    });
    expect(
      toastText(
        tile({
          state: 'needsInput',
          label: 'question',
          pending: {
            id: 'q',
            toolName: 'AskUserQuestion',
            summary: 'AskUserQuestion',
            toolInput: {},
            questions: [
              { question: 'Which color?', header: 'Color', options: [], multiSelect: false },
              { question: 'Which size?', header: 'Size', options: [], multiSelect: false },
            ],
            diff: null,
            plan: null,
            alwaysLabel: null,
          },
        }),
      ),
    ).toEqual({ title: 'Demo · question', body: 'Which color? (+1 more)' });
    expect(toastText(tile({ state: 'error', activity: { kind: 'text', text: 'overloaded' } }))).toEqual({ title: 'Demo · error', body: 'overloaded' });
  });
});

describe('update toast', () => {
  it('announces the version, also while the window has focus, and only with toasts on', () => {
    expect(updateText('0.3.0')).toEqual({ title: 'AgentTiles 0.3.0 is available', body: 'Click to update.' });
    let toasts = true;
    const notifier = new Notifier(
      () => ({ ...DEFAULT_SETTINGS, toasts }),
      () => true,
      () => undefined,
    );
    shown.length = 0;
    expect(notifier.update('0.3.0', () => undefined)).toBe(true);
    expect(shown).toEqual([{ title: 'AgentTiles 0.3.0 is available', body: 'Click to update.' }]);
    toasts = false;
    expect(notifier.update('0.4.0', () => undefined)).toBe(false);
    expect(shown).toHaveLength(1);
  });
});
