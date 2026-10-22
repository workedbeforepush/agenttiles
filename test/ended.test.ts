import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENDED_KEEP_MS, addEnded, parseEnded, unexpired } from '../src/core/ended';
import { applyHookEvent, newRecord } from '../src/core/session';
import type { EndedTileView, Snapshot } from '../src/core/types';
import { transcriptPath } from '../src/core/paths';

vi.mock('electron', () => ({}));
const { ConfigStore } = await import('../src/main/config');
const { DailyStats } = await import('../src/main/daily');
const { UsageLog } = await import('../src/main/usage');
const { LimitsCache } = await import('../src/main/limits');
const { EndedSessions } = await import('../src/main/ended');
const { SessionStore } = await import('../src/main/store');

const HOUR = 3_600_000;
const entry = (sessionId: string, endedAt: number): EndedTileView => ({
  sessionId,
  cwd: 'C:\\dev\\web-shop',
  project: 'web-shop',
  name: 'Checkout flow e2e tests',
  endedAt,
  lastPrompt: null,
  lastAssistant: null,
});

describe('ended list', () => {
  it('keeps one entry per session, most recently ended first', () => {
    const list = addEnded(addEnded(addEnded([], entry('a', 1)), entry('b', 2)), entry('a', 3));
    expect(list.map((e) => [e.sessionId, e.endedAt])).toEqual([
      ['a', 3],
      ['b', 2],
    ]);
  });

  it('drops entries 24 hours after they ended', () => {
    const now = 100 * HOUR;
    const list = [entry('a', now - ENDED_KEEP_MS + 1), entry('b', now - ENDED_KEEP_MS)];
    expect(unexpired(list, now).map((e) => e.sessionId)).toEqual(['a']);
  });

  it('reads ended.json, leaving out malformed and expired entries', () => {
    const now = 100 * HOUR;
    const raw = {
      sessions: [
        { ...entry('a', now - HOUR), lastPrompt: 'Cover the checkout flow', lastAssistant: 7 },
        { ...entry('b', now - 25 * HOUR) },
        { ...entry('c', now - HOUR), cwd: '' },
        { ...entry('d', Number.NaN) },
        'e',
        { ...entry('f', now + 48 * HOUR) },
      ],
    };
    const list = parseEnded(raw, now);
    expect(list.map((e) => e.sessionId)).toEqual(['f', 'a']);
    expect(list[0]?.endedAt).toBe(now);
    expect(list[1]?.lastPrompt).toBe('Cover the checkout flow');
    expect(list[1]?.lastAssistant).toBeNull();
    expect(parseEnded(null, now)).toEqual([]);
    expect(parseEnded({ sessions: 'x' }, now)).toEqual([]);
  });

  it('persists across restarts and survives a broken file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agenttiles-ended-'));
    try {
      const ended = new EndedSessions(dir);
      ended.add(entry('a', Date.now()));
      expect(new EndedSessions(dir).get('a')?.name).toBe('Checkout flow e2e tests');
      expect(ended.remove('a')).toBe(true);
      expect(ended.remove('a')).toBe(false);
      expect(new EndedSessions(dir).ids()).toEqual([]);
      writeFileSync(join(dir, 'ended.json'), '{ broken');
      expect(new EndedSessions(dir).ids()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tells a /clear apart from a session that ends', () => {
    const rec = newRecord('a', 'C:\\dev\\web-shop', 0);
    expect(applyHookEvent(rec, { hook_event_name: 'SessionEnd', reason: 'clear' }, 1)).toMatchObject({ ended: true, cleared: true });
    expect(applyHookEvent(rec, { hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' }, 2)).toMatchObject({
      ended: true,
      cleared: false,
    });
  });
});

describe('ended tiles in the store', () => {
  const A = '11111111-2222-4333-8444-555555555555';
  const B = '66666666-7777-4888-8999-000000000000';
  let root: string;
  let userData: string;
  let project: string;
  let registryFile: string;
  let snapshots: Snapshot[];
  let config: InstanceType<typeof ConfigStore>;
  let store: InstanceType<typeof SessionStore>;

  /**
   * The registry file of this test process: alive, so the store treats it as a running session. Its transcript exists
   * unless `conversation` is false (Claude Code writes it with the first message).
   */
  const register = (sessionId: string, conversation = true): void => {
    if (conversation) {
      const transcript = transcriptPath(project, sessionId);
      mkdirSync(dirname(transcript), { recursive: true });
      writeFileSync(transcript, `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } })}
`);
    }
    writeFileSync(
      registryFile,
      JSON.stringify({ pid: process.pid, sessionId, cwd: project, kind: 'interactive', status: 'idle', startedAt: Date.now() }),
    );
  };
  const unregister = (): void => rmSync(registryFile, { force: true });
  const last = (): Snapshot => snapshots.at(-1)!;
  /** Two registry polls: long enough for a missing entry to count as gone. */
  const polls = (count: number): void => {
    vi.advanceTimersByTime(count * 2000 + 100);
  };
  const end = (sessionId: string, reason = 'prompt_input_exit'): void => {
    store.handleEvent({ hook_event_name: 'SessionEnd', session_id: sessionId, reason }, Date.now());
    vi.advanceTimersByTime(100);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    root = mkdtempSync(join(tmpdir(), 'agenttiles-store-'));
    const claude = join(root, 'claude');
    mkdirSync(join(claude, 'sessions'), { recursive: true });
    process.env['CLAUDE_CONFIG_DIR'] = claude;
    registryFile = join(claude, 'sessions', `${process.pid}.json`);
    userData = join(root, 'userData');
    project = join(root, 'web-shop');
    mkdirSync(userData);
    mkdirSync(project);
    snapshots = [];
    config = new ConfigStore(userData);
    store = new SessionStore(
      config,
      new DailyStats(userData),
      new UsageLog(userData),
      new LimitsCache(userData),
      new EndedSessions(userData),
      () => true,
      { snapshot: (s) => snapshots.push(s), transitions: () => undefined, configChanged: () => undefined },
    );
    register(A);
    store.start();
    vi.advanceTimersByTime(100);
  });

  afterEach(() => {
    store.stop();
    vi.useRealTimers();
    delete process.env['CLAUDE_CONFIG_DIR'];
    rmSync(root, { recursive: true, force: true });
  });

  it('keeps a session that ended as an ended tile, outside the counters, also after a restart', () => {
    store.handleEvent({ hook_event_name: 'UserPromptSubmit', session_id: A, prompt: 'Cover the checkout flow' }, Date.now());
    store.handleEvent({ hook_event_name: 'Stop', session_id: A }, Date.now());
    expect(last().tiles.map((t) => t.sessionId)).toEqual([A]);
    end(A);
    expect(last().tiles).toEqual([]);
    expect(last().ended).toMatchObject([{ sessionId: A, cwd: project, project: 'web-shop', lastPrompt: 'Cover the checkout flow' }]);
    expect(last().header).toMatchObject({ working: 0, waiting: 0, done: 0 });
    expect(new EndedSessions(userData).get(A)?.cwd).toBe(project);
  });

  it('keeps no ended tile for a session that never got a message: there is nothing to resume', () => {
    const empty = '99999999-9999-4999-8999-999999999999';
    register(empty, false);
    polls(1);
    end(empty);
    polls(2);
    expect(last().ended.map((e) => e.sessionId)).not.toContain(empty);
  });

  it('keeps a session whose registry entry is gone for good', () => {
    unregister();
    polls(1);
    expect(last().ended).toEqual([]);
    polls(1);
    expect(last().ended.map((e) => e.sessionId)).toEqual([A]);
  });

  it('keeps no tile for a /clear: the same process goes on under a new id', () => {
    end(A, 'clear');
    expect(last().ended).toEqual([]);
    register(B);
    polls(2);
    expect(last().tiles.map((t) => t.sessionId)).toEqual([B]);
    expect(last().ended).toEqual([]);
  });

  it('keeps no tile for a process that went on under a new id without hooks', () => {
    register(B);
    polls(2);
    expect(last().tiles.map((t) => t.sessionId)).toEqual([B]);
    expect(last().ended).toEqual([]);
  });

  it('replaces the ended tile with the live one when the session is resumed', () => {
    end(A);
    unregister();
    polls(1);
    expect(last().ended.map((e) => e.sessionId)).toEqual([A]);
    register(A);
    polls(1);
    expect(last().tiles.map((t) => t.sessionId)).toEqual([A]);
    expect(last().ended).toEqual([]);
    expect(new EndedSessions(userData).ids()).toEqual([]);
  });

  it('never keeps a hidden session, and drops ended tiles of a project that gets hidden', () => {
    store.hideSession(A);
    end(A);
    expect(last().ended).toEqual([]);

    register(B);
    polls(1);
    end(B);
    expect(last().ended.map((e) => e.sessionId)).toEqual([B]);
    config.config.hiddenProjects = [project];
    store.changed();
    vi.advanceTimersByTime(100);
    expect(last().ended).toEqual([]);
    expect(new EndedSessions(userData).ids()).toEqual([]);
  });

  it('removes an ended tile on request or 24 hours after the end', () => {
    end(A);
    store.removeEnded(A);
    vi.advanceTimersByTime(100);
    expect(last().ended).toEqual([]);

    register(B);
    polls(1);
    end(B);
    vi.setSystemTime(Date.now() + ENDED_KEEP_MS - 60_000);
    polls(1);
    expect(last().ended.map((e) => e.sessionId)).toEqual([B]);
    vi.setSystemTime(Date.now() + 60_000);
    polls(1);
    expect(last().ended).toEqual([]);
  });
});
