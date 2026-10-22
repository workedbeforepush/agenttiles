// Reads process start times on the real system (CI runs this on macOS and Linux runners).
import { describe, expect, it } from 'vitest';
import { processStartTime } from '../src/main/platform/unix';

describe.skipIf(process.platform === 'win32')('process start time on this machine', () => {
  it('reads the start time of this process in the registry format (ps lstart, C locale, UTC)', () => {
    const started = processStartTime(process.pid);
    expect(started).not.toBeNull();
    // Claude Code reads it back the same way.
    const parsed = Date.parse(`${started} UTC`);
    expect(Math.abs(parsed - (Date.now() - process.uptime() * 1000))).toBeLessThan(5000);
    expect(processStartTime(process.pid)).toBe(started);
  });

  it('has none for a process that does not exist', () => {
    expect(processStartTime(4_194_305)).toBeNull();
  });
});
