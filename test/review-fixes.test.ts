// Regression tests for the findings of the 2026-10-21 code review.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LineSplitter, MAX_LINE_BYTES, parseEndpoint, parseMessage } from '../src/core/protocol';
import { addPending, applyHookEvent, deriveState, newRecord, type SessionRecord } from '../src/core/session';
import { installHooks, uninstallHooks } from '../src/core/hookConfig';
import type { RegistryEntry } from '../src/core/registry';
import { DailyStats } from '../src/main/daily';

const SID = 'sid-1';

function record(): SessionRecord {
  return newRecord(SID, 'C:\\work\\demo', 1000);
}

function event(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { session_id: SID, hook_event_name: name, ...extra };
}

function registry(status: string, at: number): RegistryEntry {
  return {
    pid: 42,
    sessionId: SID,
    cwd: 'C:\\work\\demo',
    name: 'demo',
    nameSource: 'derived',
    status,
    waitingFor: null,
    statusUpdatedAt: at,
    startedAt: 1,
    procStart: '1',
    kind: 'interactive',
    version: null,
    jobId: null,
  };
}

describe('protocol hardening', () => {
  it('rejects anything that is not a well-formed message', () => {
    for (const raw of ['null', '1', '[]', '"x"', '{}', '{"token":"t","kind":"event","ts":1}', '{"token":"t","kind":"nope","ts":1,"payload":{}}']) {
      expect(parseMessage(raw)).toBeNull();
    }
    expect(parseMessage('{"token":"t","kind":"permission","ts":1,"payload":{}}')).toBeNull();
    expect(parseMessage('{"v":2,"token":"t","kind":"event","ts":1,"payload":{}}')).not.toBeNull();
  });

  it('signals oversized lines instead of buffering forever', () => {
    const splitter = new LineSplitter();
    expect(splitter.push('x'.repeat(MAX_LINE_BYTES + 1))).toBeNull();
  });

  it('parses the endpoint file', () => {
    expect(parseEndpoint('{"path":"p","token":"t"}')).toEqual({ path: 'p', token: 't' });
    expect(parseEndpoint('garbage')).toBeNull();
    expect(parseEndpoint('null')).toBeNull();
  });
});

describe('event ordering', () => {
  it('ignores a state change older than the current one', () => {
    const rec = record();
    applyHookEvent(rec, event('UserPromptSubmit', { prompt: 'next' }), 2000);
    applyHookEvent(rec, event('Stop'), 1999); // delivered late
    expect(deriveState(rec).state).toBe('working');
    expect(rec.turnStartedAt).toBe(2000);
  });

  it('orders streamed message deltas by index', () => {
    const rec = record();
    applyHookEvent(rec, event('MessageDisplay', { message_id: 'm', index: 1, delta: 'world' }), 1);
    applyHookEvent(rec, event('MessageDisplay', { message_id: 'm', index: 0, delta: 'Hello ' }), 2);
    expect(rec.hookAssistant).toBe('Hello world');
  });
});

describe('tool failures', () => {
  it('treats Esc as idle, not as an error', () => {
    const rec = record();
    applyHookEvent(rec, event('PostToolUseFailure', { tool_name: 'Bash', tool_input: {}, is_interrupt: true }), 1000);
    expect(deriveState(rec).state).toBe('idle');
  });

  it('keeps working after an ordinary tool failure and is not sticky', () => {
    const rec = record();
    applyHookEvent(rec, event('PostToolUseFailure', { tool_name: 'Grep', tool_input: { pattern: 'x' }, error: 'no matches' }), 1000);
    expect(deriveState(rec)).toMatchObject({ state: 'working', activity: 'Grep: x failed: no matches' });
    rec.registry = registry('idle', 2000);
    expect(deriveState(rec).state).toBe('idle');
  });
});

describe('permission release', () => {
  it('releases one request per tool event even for identical parallel calls', () => {
    const rec = record();
    const input = { tool_name: 'Bash', tool_input: { command: 'ls' } };
    addPending(rec, 'a', event('PermissionRequest', input), 1);
    addPending(rec, 'b', event('PermissionRequest', input), 2);
    expect(applyHookEvent(rec, event('PostToolUse', input), 3).release).toEqual(['a']);
    expect(rec.pending.map((p) => p.id)).toEqual(['b']);
  });

  it('falls back to the only pending request of the same tool when the input was modified', () => {
    const rec = record();
    addPending(rec, 'a', event('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } }), 1);
    const effects = applyHookEvent(rec, event('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls -la' } }), 2);
    expect(effects.release).toEqual(['a']);
  });

  it('keeps long commands readable in the permission summary', () => {
    const rec = record();
    const command = `rm -rf ${'x'.repeat(150)}`;
    addPending(rec, 'a', event('PermissionRequest', { tool_name: 'Bash', tool_input: { command } }), 1);
    expect(rec.pending[0]?.summary).toBe(`Bash: ${command}`);
  });
});

describe('settings.json merge edge cases', () => {
  const options = { nodePath: 'node', hookPath: '/x/agenttiles-hook.js', permissionTimeoutSec: 600 };

  it('keeps foreign groups with an empty hooks list and foreign empty events', () => {
    const settings = { hooks: { Stop: [{ matcher: '', hooks: [] }], Custom: [] } };
    expect(uninstallHooks(installHooks(settings, options))).toEqual(settings);
  });

  it('removes events that held only AgentTiles entries of an older version', () => {
    const old = { hooks: { RetiredEvent: [{ hooks: [{ type: 'command', command: 'node', args: ['/x/agenttiles-hook.js', 'hook'] }] }] } };
    const hooks = installHooks(old, options)['hooks'] as Record<string, unknown>;
    expect(hooks['RetiredEvent']).toBeUndefined();
  });
});

describe('daily stats robustness', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agenttiles-daily-robust-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('starts over instead of failing on a damaged today.json', () => {
    writeFileSync(join(dir, 'today.json'), '{"date": "2026-10-21", "cos');
    expect(new DailyStats(dir).view().turns).toBe(0);
  });

  it('forgets carried baselines of sessions that no longer run', () => {
    const stats = new DailyStats(dir);
    const yesterday = new Date().setHours(0, 0, 0, 0) - 1;
    stats.recordCost('gone', 5, yesterday, 'p'); // baseline = latest = 5, contributes nothing today
    stats.recordCost('live', 5, yesterday, 'p');
    stats.retain(new Set(['live']));
    stats.recordCost('gone', 7, yesterday, 'p'); // re-seen later: new baseline, still 0 today
    expect(stats.view().costUsd).toBe(0);
    stats.flush();
  });
});
