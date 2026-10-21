import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({}));
const { parseProbeOutput } = await import('../src/main/limitProbe');

describe('limit probe output', () => {
  it('reads both windows from the rate_limit_event', () => {
    const stdout = [
      '{"type":"system","subtype":"init"}',
      '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","unifiedWindows":{"five_hour":{"utilization":0.41,"resetsAt":1792580400},"seven_day":{"utilization":0.163,"resetsAt":1792821600}}}}',
      '{"type":"result","total_cost_usd":0.0001}',
    ].join('\n');
    expect(parseProbeOutput(stdout, 1000)).toEqual({
      fiveHour: { usedPct: 41, resetsAt: 1792580400, observedAt: 1000 },
      sevenDay: { usedPct: 16.3, resetsAt: 1792821600, observedAt: 1000 },
    });
  });

  it('returns null without a rate_limit_event', () => {
    expect(parseProbeOutput('{"type":"result"}\nnot json', 1)).toBeNull();
  });
});
