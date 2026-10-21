// Regression tests for the findings of the second 2026-10-21 code review.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lineDiff, toolDiff } from '../src/core/diff';
import { acceleratorOf, hasModifier } from '../src/renderer/src/keys';
import { Attention } from '../src/main/attention';
import { DailyStats } from '../src/main/daily';
import type { TileView } from '../src/core/types';

function withDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'ccdash-r2-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('diff of big files', () => {
  it('shows a one-line change in a file far beyond the LCS limit', () => {
    const before = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 2500', 'changed');
    const lines = lineDiff(before, after);
    expect(lines.filter((l) => l.kind === 'del')).toEqual([{ kind: 'del', text: 'line 2500' }]);
    expect(lines.filter((l) => l.kind === 'add')).toEqual([{ kind: 'add', text: 'changed' }]);
  });

  it('notes line ending changes and ignores a BOM', () => {
    expect(toolDiff('Write', { file_path: 'a', content: 'x\ny\n' }, '﻿x\r\ny\r\n')).toMatchObject({
      added: 0,
      removed: 0,
      note: 'line endings change to LF',
    });
  });
});

describe('global hotkey', () => {
  it('needs a modifier and uses Electron key names', () => {
    expect(hasModifier('D')).toBe(false);
    expect(hasModifier('Ctrl+Alt+C')).toBe(true);
    expect(acceleratorOf('Ctrl+ArrowUp')).toBe('Ctrl+Up');
  });
});

describe('reminders', () => {
  it('does not remind on first sight of a session that already waits long', () => {
    const a = new Attention();
    const tile = { sessionId: 's', name: 'Demo', state: 'needsApproval', stateSince: 0, contextPct: null } as unknown as TileView;
    const settings = { reminderMin: 5, contextWarnPct: 0 };
    expect(a.check([tile], 12 * 60_000, settings)).toEqual([]);
    expect(a.check([tile], 15 * 60_000, settings)).toHaveLength(1);
  });
});

describe('daily stats robustness', () => {
  it('splits state time across midnight', () => {
    withDir((dir) => {
      let now = new Date(2026, 9, 20, 23, 0).getTime();
      const stats = new DailyStats(dir, () => now);
      now = new Date(2026, 9, 21, 1, 0).getTime();
      stats.addStateTime('working', 3 * 3_600_000, 'web'); // 22:00 -> 01:00
      const days = stats.stats(2).days;
      expect(days[0]?.projects['web']?.workingMs).toBe(2 * 3_600_000);
      expect(days[1]?.projects['web']?.workingMs).toBe(3_600_000);
      stats.flush();
    });
  });

  it('keeps project names like __proto__ as plain keys', () => {
    withDir((dir) => {
      const stats = new DailyStats(dir);
      stats.turn('__proto__');
      stats.turn('constructor');
      const projects = stats.stats(1).days[0]?.projects ?? {};
      expect(projects['__proto__']?.turns).toBe(1);
      expect(projects['constructor']?.turns).toBe(1);
      expect(({} as Record<string, unknown>)['turns']).toBeUndefined();
      stats.flush();
    });
  });

  it('reads broken numbers in history.json as 0', () => {
    withDir((dir) => {
      const today = new Date();
      const pad = (n: number): string => String(n).padStart(2, '0');
      const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
      const date = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;
      writeFileSync(join(dir, 'history.json'), JSON.stringify({ days: [{ date, projects: { web: { costUsd: 'x', turns: 2 } } }, { date: 'bad' }] }));
      const day = new DailyStats(dir).stats(2).days[0];
      expect(day?.projects['web']).toEqual({ costUsd: 0, turns: 2, workingMs: 0, waitingMs: 0 });
    });
  });
});
