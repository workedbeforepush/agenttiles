import { describe, expect, it } from 'vitest';
import { collapse, lineDiff, toolDiff } from '../src/core/diff';
import { suggestionLabel, suggestionsOf } from '../src/core/permissions';
import { permissionOutput, replyExtras } from '../src/core/protocol';
import { addPending, deriveState, newRecord, toTile } from '../src/core/session';
import { Attention } from '../src/main/attention';
import type { TileView } from '../src/core/types';

describe('line diff', () => {
  it('marks removed and added lines around common ones', () => {
    expect(lineDiff('a\nb\nc\n', 'a\nB\nc\n')).toEqual([
      { kind: 'ctx', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'B' },
      { kind: 'ctx', text: 'c' },
    ]);
    expect(lineDiff('', 'x')).toEqual([{ kind: 'add', text: 'x' }]);
  });

  it('collapses long unchanged runs', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    const after = before.replace('l10', 'changed');
    const lines = collapse(lineDiff(before, after));
    expect(lines[0]).toEqual({ kind: 'skip', text: '7 unchanged lines' });
    expect(lines.filter((l) => l.kind === 'ctx')).toHaveLength(6);
    expect(lines.at(-1)).toEqual({ kind: 'skip', text: '6 unchanged lines' });
  });

  it('builds diffs for Edit and Write', () => {
    const edit = toolDiff('Edit', { file_path: 'C:\\x\\a.ts', old_string: 'one', new_string: 'two', replace_all: true }, null);
    expect(edit).toMatchObject({ path: 'C:\\x\\a.ts', added: 1, removed: 1, note: 'every occurrence', truncated: false });
    expect(toolDiff('Write', { file_path: '/n.txt', content: 'a\nb\n' }, null)).toMatchObject({ added: 2, removed: 0, note: 'new file' });
    expect(toolDiff('Write', { file_path: '/n.txt', content: 'a\nc\n' }, 'a\nb\n')).toMatchObject({ added: 1, removed: 1, note: null });
    expect(toolDiff('Bash', { command: 'ls' }, null)).toBeNull();
  });
});

describe('permission suggestions', () => {
  // Captured from Claude Code 2.x PermissionRequest inputs.
  const bash = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'git --version' }], behavior: 'allow', destination: 'localSettings' }];
  const edit = [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }];

  it('labels what always-allow does', () => {
    expect(suggestionLabel(bash)).toBe('Always allow Bash(git --version) in this project');
    expect(suggestionLabel(edit)).toBe('Allow all edits in this session');
    expect(suggestionLabel([])).toBeNull();
  });

  it('keeps only well-formed suggestions', () => {
    expect(suggestionsOf({ permission_suggestions: [...bash, 'x', null, { no: 'type' }] })).toEqual(bash);
    expect(suggestionsOf({})).toEqual([]);
  });

  it('carries diff, plan and label to the tile', () => {
    const rec = newRecord('s', 'C:\\w', 0);
    addPending(rec, 'p1', { tool_name: 'Bash', tool_input: { command: 'git --version' }, permission_suggestions: bash }, 1);
    expect(toTile(rec, { rename: null, pinned: false, branch: null }).pending).toMatchObject({
      alwaysLabel: 'Always allow Bash(git --version) in this project',
      diff: null,
      plan: null,
    });
    const plan = newRecord('s2', 'C:\\w', 0);
    addPending(plan, 'p2', { tool_name: 'ExitPlanMode', tool_input: { plan: '# Plan\n- a', planFilePath: 'x.md' } }, 1);
    expect(deriveState(plan)).toMatchObject({ state: 'needsInput', label: 'plan ready' });
    expect(toTile(plan, { rename: null, pinned: false, branch: null }).pending?.plan).toBe('# Plan\n- a');
  });
});

describe('decision output', () => {
  const ACCEPT_EDITS = [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }];

  it('passes permission updates on allow and the message on deny', () => {
    const allow = JSON.parse(permissionOutput('allow', { updatedPermissions: ACCEPT_EDITS }));
    expect(allow.hookSpecificOutput.decision).toEqual({ behavior: 'allow', updatedPermissions: ACCEPT_EDITS });
    const deny = JSON.parse(permissionOutput('deny', { message: 'Split step 2.' }));
    expect(deny.hookSpecificOutput.decision).toEqual({ behavior: 'deny', message: 'Split step 2.' });
  });

  it('drops reply fields that do not fit the decision', () => {
    expect(replyExtras({ id: 'a', decision: 'deny', updatedPermissions: ACCEPT_EDITS, message: ' no ' })).toEqual({ message: ' no ' });
    expect(replyExtras({ id: 'a', decision: 'allow', message: 'x', updatedPermissions: ['bad' as never] })).toEqual({});
  });
});

describe('attention', () => {
  const tile = (over: Partial<TileView>): TileView =>
    ({ sessionId: 's', name: 'Demo', state: 'needsApproval', stateSince: 0, contextPct: null, ...over }) as TileView;
  const settings = { reminderMin: 5, contextWarnPct: 80 };

  it('reminds every interval of one wait', () => {
    const a = new Attention();
    expect(a.check([tile({})], 4 * 60_000, settings)).toEqual([]);
    expect(a.check([tile({})], 5 * 60_000, settings).map((n) => n.kind)).toEqual(['reminder']);
    expect(a.check([tile({})], 6 * 60_000, settings)).toEqual([]);
    expect(a.check([tile({})], 10 * 60_000, settings)).toHaveLength(1);
    // A new wait starts counting again.
    expect(a.check([tile({ stateSince: 10 * 60_000 })], 11 * 60_000, settings)).toEqual([]);
    expect(a.check([tile({ state: 'working' })], 30 * 60_000, settings)).toEqual([]);
  });

  it('warns once per context fill and not for sessions already full at start', () => {
    const a = new Attention();
    const s = { reminderMin: 0, contextWarnPct: 80 };
    expect(a.check([tile({ sessionId: 'full', contextPct: 90 })], 0, s)).toEqual([]);
    expect(a.check([tile({ contextPct: 50 })], 0, s)).toEqual([]);
    expect(a.check([tile({ contextPct: 81 })], 0, s).map((n) => n.kind)).toEqual(['contextFull']);
    expect(a.check([tile({ contextPct: 85 })], 0, s)).toEqual([]);
    expect(a.check([tile({ contextPct: 20 })], 0, s)).toEqual([]);
    expect(a.check([tile({ contextPct: 82 })], 0, s)).toHaveLength(1);
  });
});
