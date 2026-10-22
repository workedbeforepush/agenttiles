import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { usageCost, type TokenUsage } from '../src/core/pricing';
import { addUsage, parseUsageLine, usageCsv, type UsageDay } from '../src/core/usage';
import { UsageLog } from '../src/main/usage';

function line(id: string, usage: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-10-22T08:00:00.000Z',
    cwd: 'C:\\work\\demo-project',
    requestId: `req_${id}`,
    message: { id: `msg_${id}`, model: 'claude-opus-5-5', usage },
    ...extra,
  });
}

const USAGE = {
  input_tokens: 1000,
  output_tokens: 2000,
  cache_read_input_tokens: 100_000,
  cache_creation_input_tokens: 3000,
  cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 2000 },
};

function tokens(extra: Partial<TokenUsage>): TokenUsage {
  return {
    model: 'claude-opus-5-5',
    inputTokens: 0,
    outputTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: 0,
    webSearches: 0,
    fast: false,
    usOnly: false,
    ...extra,
  };
}

describe('pricing', () => {
  it('prices input, output and both cache durations', () => {
    // Opus 5.5: $4 in, $20 out, writes 1.25x / 2x, reads 0.05x.
    const cost = usageCost(
      tokens({ inputTokens: 1e6, outputTokens: 1e6, cacheWrite5mTokens: 1e6, cacheWrite1hTokens: 1e6, cacheReadTokens: 1e6 }),
    );
    expect(cost).toBeCloseTo(4 + 20 + 5 + 8 + 0.2);
  });

  it('finds dated model ids by prefix and knows older models', () => {
    expect(usageCost(tokens({ model: 'claude-sonnet-4-5-20250929', outputTokens: 1e6 }))).toBeCloseTo(15);
    expect(usageCost(tokens({ model: 'claude-opus-4-1-20250805', inputTokens: 1e6 }))).toBeCloseTo(15);
    expect(usageCost(tokens({ model: 'claude-fable-5-1', cacheReadTokens: 1e6 }))).toBeCloseTo(0.25);
  });

  it('applies fast mode, long Haiku prompts, US-only inference and web searches', () => {
    expect(usageCost(tokens({ fast: true, outputTokens: 1e6 }))).toBeCloseTo(40);
    expect(usageCost(tokens({ model: 'claude-haiku-5-5', inputTokens: 100_000, outputTokens: 1e6 }))).toBeCloseTo(0.51);
    expect(usageCost(tokens({ model: 'claude-haiku-5-5', inputTokens: 100_001 }))).toBeCloseTo(0.05);
    expect(usageCost(tokens({ usOnly: true, inputTokens: 1e6 }))).toBeCloseTo(4.4);
    expect(usageCost(tokens({ webSearches: 3 }))).toBeCloseTo(0.03);
  });

  it('returns null for an unknown model', () => {
    expect(usageCost(tokens({ model: 'claude-future-9', inputTokens: 1 }))).toBeNull();
  });
});

describe('transcript usage', () => {
  it('parses an assistant line with usage', () => {
    expect(parseUsageLine(line('a', USAGE))).toMatchObject({
      key: 'msg_a:req_a',
      project: 'demo-project',
      model: 'claude-opus-5-5',
      inputTokens: 1000,
      outputTokens: 2000,
      cacheWrite5mTokens: 1000,
      cacheWrite1hTokens: 2000,
      cacheReadTokens: 100_000,
    });
  });

  it('counts an old total cache write as 5 minutes', () => {
    const { cache_creation: _, ...old } = USAGE;
    expect(parseUsageLine(line('a', old))).toMatchObject({ cacheWrite5mTokens: 3000, cacheWrite1hTokens: 0 });
  });

  it('skips user lines, synthetic messages and broken JSON', () => {
    expect(parseUsageLine(line('a', USAGE, { type: 'user' }))).toBeNull();
    expect(
      parseUsageLine(line('a', USAGE, { message: { id: 'm', model: '<synthetic>', usage: USAGE } })),
    ).toBeNull();
    expect(parseUsageLine('{"usage": ')).toBeNull();
  });

  it('marks a model total without price as unknown cost', () => {
    const day: UsageDay = {};
    addUsage(day, parseUsageLine(line('a', USAGE))!);
    addUsage(day, { ...parseUsageLine(line('b', USAGE))!, model: 'claude-future-9' });
    expect(day['demo-project']?.['claude-opus-5-5']?.costUsd).toBeGreaterThan(0);
    expect(day['demo-project']?.['claude-future-9']?.costUsd).toBeNull();
  });

  it('writes CSV with quoting and defused formulas', () => {
    const csv = usageCsv({
      '2026-10-22': { '=cmd,x': { 'claude-opus-5-5': { inputTokens: 1, outputTokens: 2, cacheWriteTokens: 3, cacheReadTokens: 4, costUsd: null } } },
    });
    expect(csv.split('\n')[1]).toBe(`2026-10-22,"'=cmd,x",claude-opus-5-5,1,2,3,4,`);
  });
});

describe('UsageLog', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agenttiles-usage-'));
  const root = join(dir, 'projects');
  const data = join(dir, 'data');
  mkdirSync(join(root, 'demo', 'session', 'subagents'), { recursive: true });
  mkdirSync(data);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const date = (() => {
    const d = new Date('2026-10-22T08:00:00.000Z');
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  })();
  const now = (): number => Date.parse('2026-10-23T08:00:00.000Z');

  it('reads transcripts once, counts each response once and keeps unfinished lines for later', async () => {
    const main = join(root, 'demo', 'session.jsonl');
    // The same response twice (one line per content block) and a line still being written.
    writeFileSync(main, `${line('a', USAGE)}\n${line('a', USAGE)}\n${line('b', USAGE).slice(0, 40)}`);
    writeFileSync(join(root, 'demo', 'session', 'subagents', 'agent-1.jsonl'), `${line('c', USAGE)}\n`);
    const log = new UsageLog(data, root, now);
    expect(await log.scan()).toBe(true);
    expect(log.day(date)['demo-project']?.['claude-opus-5-5']?.outputTokens).toBe(4000);

    appendFileSync(main, `${line('b', USAGE).slice(40)}\n`);
    expect(await log.scan()).toBe(true);
    expect(log.day(date)['demo-project']?.['claude-opus-5-5']?.outputTokens).toBe(6000);
    expect(await log.scan()).toBe(false);

    // A fork copies earlier responses into a new transcript: they do not count again.
    writeFileSync(join(root, 'demo', 'fork.jsonl'), `${line('a', USAGE)}\n`);
    expect(await log.scan()).toBe(false);
  });

  it('keeps days after the transcripts are gone', async () => {
    rmSync(join(root, 'demo'), { recursive: true, force: true });
    const log = new UsageLog(data, root, now);
    await log.scan();
    expect(log.day(date)['demo-project']?.['claude-opus-5-5']?.outputTokens).toBe(6000);
    expect(log.firstDate()).toBe(date);
    expect(log.models([date])['claude-opus-5-5']?.inputTokens).toBe(3000);
  });
});
