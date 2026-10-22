import { describe, expect, it, vi } from 'vitest';
import type { TileView } from '../src/core/types';

vi.mock('electron', () => ({ Notification: class {} }));
const { toastText } = await import('../src/main/notifier');

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
