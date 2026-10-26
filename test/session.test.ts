import { describe, expect, it } from 'vitest';
import {
  addPending,
  applyHookEvent,
  deriveState,
  applyStatusline,
  newRecord,
  refreshView,
  tileName,
  toTile,
  type SessionRecord,
} from '../src/core/session';
import type { RegistryEntry } from '../src/core/registry';

const SID = 'sid-1';

function record(): SessionRecord {
  return newRecord(SID, 'C:\\work\\demo', 1000);
}

function registry(status: string, at: number, extra: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    pid: 42,
    sessionId: SID,
    cwd: 'C:\\work\\demo',
    name: 'demo-1a',
    nameSource: 'derived',
    status,
    waitingFor: null,
    statusUpdatedAt: at,
    startedAt: 500,
    procStart: '1',
    kind: 'interactive',
    jobId: null,
    entrypoint: 'cli',
    version: '2.1.306',
    ...extra,
  };
}

function event(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { session_id: SID, hook_event_name: name, cwd: 'C:\\work\\demo', transcript_path: 't.jsonl', ...extra };
}

describe('state derivation', () => {
  it('maps registry statuses for hook-less sessions', () => {
    const rec = record();
    rec.registry = registry('busy', 2000);
    expect(deriveState(rec).state).toBe('working');
    rec.registry = registry('waiting', 2000, { waitingFor: 'permission prompt' });
    expect(deriveState(rec).state).toBe('needsApproval');
    rec.registry = registry('waiting', 2000, { waitingFor: 'input needed' });
    expect(deriveState(rec).state).toBe('needsInput');
    rec.registry = registry('shell', 2000);
    expect(deriveState(rec).state).toBe('shell');
    rec.registry = registry('teleporting', 2000);
    expect(deriveState(rec)).toMatchObject({ state: 'unknown', label: null });
  });

  it('distinguishes done from idle by the transcript for hook-less sessions', () => {
    const rec = record();
    rec.registry = registry('idle', 2000);
    expect(deriveState(rec).state).toBe('idle');
    rec.transcript.lastPromptAt = 100;
    rec.transcript.lastAssistantAt = 200;
    expect(deriveState(rec).state).toBe('done');
  });

  it('lets the newest source win and the hook win ties', () => {
    const rec = record();
    rec.registry = registry('busy', 2000);
    applyHookEvent(rec, event('Stop'), 3000);
    expect(deriveState(rec).state).toBe('done');
    rec.registry = registry('busy', 4000);
    expect(deriveState(rec).state).toBe('working');
    applyHookEvent(rec, event('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }), 4000);
    expect(deriveState(rec)).toMatchObject({ state: 'working', activity: { kind: 'text', text: 'Bash: ls' } });
  });

  it('keeps a fresh hook session idle until a turn finished', () => {
    const rec = record();
    applyHookEvent(rec, event('SessionStart'), 2000);
    rec.registry = registry('idle', 2500);
    expect(deriveState(rec).state).toBe('idle');
    applyHookEvent(rec, event('Stop'), 3000);
    rec.registry = registry('idle', 3500);
    expect(deriveState(rec).state).toBe('done');
  });

  it('maps question tools and notifications', () => {
    const rec = record();
    applyHookEvent(rec, event('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: {} }), 2000);
    expect(deriveState(rec)).toMatchObject({ state: 'needsInput', label: 'question' });
    applyHookEvent(rec, event('PreToolUse', { tool_name: 'ExitPlanMode', tool_input: {} }), 2100);
    expect(deriveState(rec)).toMatchObject({ state: 'needsInput', label: 'planReady' });
    applyHookEvent(rec, event('Notification', { notification_type: 'permission_prompt' }), 2200);
    expect(deriveState(rec).state).toBe('needsApproval');
    applyHookEvent(rec, event('StopFailure', { error: 'overloaded' }), 2300);
    expect(deriveState(rec)).toMatchObject({ state: 'error', activity: { kind: 'text', text: 'overloaded' } });
    applyHookEvent(rec, event('PreCompact'), 2400);
    expect(deriveState(rec).state).toBe('compacting');
  });

  it('returns to the state before an idle compaction', () => {
    const rec = record();
    applyHookEvent(rec, event('UserPromptSubmit'), 1000);
    applyHookEvent(rec, event('Stop'), 2000);
    applyHookEvent(rec, event('PreCompact', { trigger: 'auto' }), 3000);
    expect(deriveState(rec).state).toBe('compacting');
    applyHookEvent(rec, event('SessionStart', { source: 'compact' }), 4000);
    applyHookEvent(rec, event('PostCompact', { trigger: 'auto' }), 4000);
    expect(deriveState(rec).state).toBe('done');
  });

  it('keeps working after a compaction inside a turn', () => {
    const rec = record();
    applyHookEvent(rec, event('UserPromptSubmit'), 1000);
    applyHookEvent(rec, event('PreCompact', { trigger: 'auto' }), 2000);
    applyHookEvent(rec, event('PostCompact', { trigger: 'auto' }), 3000);
    applyHookEvent(rec, event('SessionStart', { source: 'compact' }), 3000);
    expect(deriveState(rec).state).toBe('working');
  });

  it('counts subagents and tasks', () => {
    const rec = record();
    applyHookEvent(rec, event('SubagentStart', { agent_id: 'a' }), 1);
    applyHookEvent(rec, event('SubagentStart', { agent_id: 'b' }), 2);
    applyHookEvent(rec, event('SubagentStop', { agent_id: 'a' }), 3);
    applyHookEvent(rec, event('TaskCreated', { task_id: 't1' }), 4);
    applyHookEvent(rec, event('TaskCreated', { task_id: 't2' }), 5);
    applyHookEvent(rec, event('TaskCompleted', { task_id: 't1' }), 6);
    const tile = toTile(rec, { rename: null, pinned: false, branch: null });
    expect(tile.subagents).toBe(1);
    expect([tile.tasksDone, tile.tasksTotal]).toEqual([1, 2]);
  });

  it('accumulates streamed assistant text per message', () => {
    const rec = record();
    applyHookEvent(rec, event('MessageDisplay', { message_id: 'm1', delta: 'Hello ' }), 1);
    applyHookEvent(rec, event('MessageDisplay', { message_id: 'm1', delta: 'world' }), 2);
    expect(rec.hookAssistant).toBe('Hello world');
    applyHookEvent(rec, event('MessageDisplay', { message_id: 'm2', delta: 'Next' }), 3);
    expect(rec.hookAssistant).toBe('Next');
  });
});

describe('permissions', () => {
  const bash = { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } };

  it('shows a pending permission until a matching tool event releases it', () => {
    const rec = record();
    addPending(rec, 'p1', event('PermissionRequest', bash), 1000);
    expect(deriveState(rec)).toMatchObject({ state: 'needsApproval', activity: { kind: 'text', text: 'Bash: rm -rf build' } });
    const other = applyHookEvent(rec, event('PostToolUse', { tool_name: 'Read', tool_input: { file_path: 'x' } }), 1100);
    expect(other.release).toEqual([]);
    const matching = applyHookEvent(rec, event('PostToolUse', bash), 1200);
    expect(matching.release).toEqual(['p1']);
    expect(rec.pending).toHaveLength(0);
  });

  it('releases every pending permission when the turn ends', () => {
    const rec = record();
    addPending(rec, 'p1', event('PermissionRequest', bash), 1000);
    addPending(rec, 'p2', event('PermissionRequest', { tool_name: 'Write', tool_input: { file_path: 'a' } }), 1000);
    expect(applyHookEvent(rec, event('Stop'), 2000).release).toEqual(['p1', 'p2']);
  });

  it('reports SessionEnd', () => {
    expect(applyHookEvent(record(), event('SessionEnd', { reason: 'other' }), 1).ended).toBe(true);
  });
});

describe('tiles', () => {
  it('uses the name priority rename > user name > ai-title > derived', () => {
    const rec = record();
    rec.registry = registry('idle', 1);
    expect(tileName(rec, null)).toBe('demo-1a');
    rec.transcript.aiTitle = 'Demo Work';
    expect(tileName(rec, null)).toBe('Demo Work');
    rec.registry = registry('idle', 1, { name: 'my-name', nameSource: 'user' });
    expect(tileName(rec, null)).toBe('my-name');
    expect(tileName(rec, 'Renamed')).toBe('Renamed');
  });

  it('shows transcript activity only for hook-less sessions', () => {
    const rec = record();
    rec.registry = registry('busy', 2000);
    rec.transcript.activeTool = 'Bash: npm test';
    expect(toTile(rec, { rename: null, pinned: false, branch: null }).activity).toEqual({ kind: 'text', text: 'Bash: npm test' });
    applyHookEvent(rec, event('PostToolUse', { tool_name: 'Bash', tool_input: {} }), 1000);
    expect(toTile(rec, { rename: null, pinned: false, branch: null }).activity).toEqual({ kind: 'thinking' });
  });

  it('keeps stateSince while the state is unchanged and reports the previous state on change', () => {
    const rec = record();
    rec.registry = registry('busy', 2000);
    expect(refreshView(rec, 2000)).toBeNull();
    expect(refreshView(rec, 5000)).toBeNull();
    expect(rec.view.since).toBe(2000);
    rec.registry = registry('idle', 9000);
    rec.transcript.lastPromptAt = 1;
    rec.transcript.lastAssistantAt = 2;
    expect(refreshView(rec, 9000)).toEqual({ from: 'working', durationMs: 7000 });
    expect(rec.history.map((p) => p.state)).toEqual(['working', 'done']);
  });

  it('keeps 30 minutes of history plus the state at the window start', () => {
    const rec = record();
    const minute = 60_000;
    rec.registry = registry('busy', 0);
    refreshView(rec, 0);
    rec.registry = registry('shell', minute);
    refreshView(rec, minute);
    rec.registry = registry('busy', 40 * minute);
    refreshView(rec, 40 * minute);
    expect(rec.history.map((p) => p.state)).toEqual(['shell', 'working']);
  });
});

describe('turns, tools and details', () => {
  it('measures the running and the last turn', () => {
    const rec = record();
    applyHookEvent(rec, event('UserPromptSubmit', { prompt: 'go' }), 1000);
    expect(toTile(rec, { rename: null, pinned: false, branch: null }).turnStartedAt).toBe(1000);
    applyHookEvent(rec, event('Stop'), 61_000);
    const tile = toTile(rec, { rename: null, pinned: false, branch: null });
    expect(tile.turnStartedAt).toBeNull();
    expect(tile.lastTurnMs).toBe(60_000);
  });

  it('keeps the last three tool calls', () => {
    const rec = record();
    for (const command of ['a', 'b', 'c', 'd']) {
      applyHookEvent(rec, event('PreToolUse', { tool_name: 'Bash', tool_input: { command } }), 1);
    }
    expect(toTile(rec, { rename: null, pinned: false, branch: null }).recentTools).toEqual(['Bash: b', 'Bash: c', 'Bash: d']);
  });

  it('lists task subjects and subagent types', () => {
    const rec = record();
    applyHookEvent(rec, event('TaskCreated', { task_id: 't1', task_subject: 'Write tests' }), 1);
    applyHookEvent(rec, event('TaskCompleted', { task_id: 't1', task_subject: 'Write tests' }), 2);
    applyHookEvent(rec, event('SubagentStart', { agent_id: 'a1', agent_type: 'Explore' }), 3);
    const tile = toTile(rec, { rename: null, pinned: false, branch: null });
    expect(tile.tasks).toEqual([{ subject: 'Write tests', done: true }]);
    expect(tile.subagentTypes).toEqual(['Explore']);
  });

  it('takes git details from the statusline and falls back to the transcript branch', () => {
    const rec = record();
    rec.transcript.gitBranch = 'main';
    expect(toTile(rec, { rename: null, pinned: false, branch: null }).git.branch).toBe('main');
    applyStatusline(rec, {
      cost: { total_lines_added: 156, total_lines_removed: 23 },
      worktree: { name: 'feature-x', branch: 'worktree-feature-x' },
      pr: { number: 1234, url: 'https://example.test/pr/1234', review_state: 'pending' },
    });
    expect(toTile(rec, { rename: null, pinned: false, branch: null }).git).toEqual({
      branch: 'worktree-feature-x',
      worktree: 'feature-x',
      pr: { number: 1234, url: 'https://example.test/pr/1234', reviewState: 'pending' },
      linesAdded: 156,
      linesRemoved: 23,
    });
  });
});

describe('failures', () => {
  it('shows a rate limit as limitHit and keeps it when the registry turns idle', () => {
    const rec = record();
    applyHookEvent(rec, event('StopFailure', { error: 'rate_limit' }), 1000);
    rec.registry = registry('idle', 2000);
    expect(deriveState(rec).state).toBe('limitHit');
  });

  it('keeps an error when the registry turns idle, and leaves it on the next turn', () => {
    const rec = record();
    applyHookEvent(rec, event('StopFailure', { error: 'server_error' }), 1000);
    rec.registry = registry('idle', 2000);
    expect(deriveState(rec)).toMatchObject({ state: 'error', activity: { kind: 'text', text: 'server_error' } });
    rec.registry = registry('busy', 3000);
    expect(deriveState(rec).state).toBe('working');
  });
});
