// Asks Claude Code for the current plan limits with a minimal print-mode request (~600 tokens).
// The stream-json output of `claude -p` contains a rate_limit_event with both windows; the statusline only reports
// limits after a session's next API response, so this keeps the header current at start and while idle.
import { spawn } from 'node:child_process';
import { cleanEnv } from './env';
import type { RateLimit } from '../core/types';
import { log } from './log';

const PROBE_TIMEOUT_MS = 60_000;

/** Smallest request that still reaches the API: no tools, no MCP, no settings (so no hooks), no saved session. */
const PROBE_ARGS = [
  '-p',
  'ok',
  '--model',
  'haiku',
  '--tools',
  '',
  '--system-prompt',
  'Reply ok.',
  '--no-session-persistence',
  '--strict-mcp-config',
  '--disable-slash-commands',
  '--setting-sources',
  '',
  '--output-format',
  'stream-json',
  '--verbose',
];

export interface ProbedLimits {
  fiveHour: RateLimit | null;
  sevenDay: RateLimit | null;
}

function windowOf(raw: unknown, observedAt: number): RateLimit | null {
  if (!raw || typeof raw !== 'object') return null;
  const w = raw as Record<string, unknown>;
  if (typeof w['utilization'] !== 'number') return null;
  return {
    usedPct: Math.round(w['utilization'] * 1000) / 10,
    resetsAt: typeof w['resetsAt'] === 'number' ? w['resetsAt'] : null,
    observedAt,
  };
}

/** Extracts both windows from the stream-json lines; null when no rate_limit_event was printed. */
export function parseProbeOutput(stdout: string, observedAt: number): ProbedLimits | null {
  for (const line of stdout.split('\n')) {
    if (!line.includes('"rate_limit_event"')) continue;
    try {
      const event = JSON.parse(line) as { type?: unknown; rate_limit_info?: { unifiedWindows?: Record<string, unknown> } };
      const windows = event.type === 'rate_limit_event' ? event.rate_limit_info?.unifiedWindows : undefined;
      if (!windows) continue;
      return { fiveHour: windowOf(windows['five_hour'], observedAt), sevenDay: windowOf(windows['seven_day'], observedAt) };
    } catch {
      // not the line we are looking for
    }
  }
  return null;
}

/** Environment without the variables a parent Claude Code session sets, so the probe runs as a top-level session. */
/**
 * Runs the probe. `onProcess` receives the probe's pid at start and again with `running = false` at the end: the probe
 * registers itself in ~/.claude/sessions like an interactive session and must not show up as a tile.
 */
export function probeLimits(onProcess: (pid: number, running: boolean) => void): Promise<ProbedLimits | null> {
  return new Promise((resolve) => {
    const child = spawn('claude', PROBE_ARGS, { env: cleanEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const pid = child.pid;
    if (pid !== undefined) onProcess(pid, true);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const timer = setTimeout(() => child.kill(), PROBE_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      log.warn(`limit probe could not start claude: ${error.message}`);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (pid !== undefined) onProcess(pid, false);
      const limits = parseProbeOutput(stdout, Date.now());
      if (!limits) log.warn(`limit probe returned no limits (exit ${code}): ${stderr.slice(0, 200)}`);
      resolve(limits);
    });
  });
}
