import { homedir } from 'node:os';
import { basename, join } from 'node:path';

export function claudeDir(): string {
  return process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude');
}

export function sessionsDir(): string {
  return join(claudeDir(), 'sessions');
}

export function userSettingsPath(): string {
  return join(claudeDir(), 'settings.json');
}

/** Project folder slug used by Claude Code: every non-alphanumeric character becomes '-'. */
export function projectSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

export function transcriptPath(cwd: string, sessionId: string): string {
  return join(claudeDir(), 'projects', projectSlug(cwd), `${sessionId}.jsonl`);
}

export function projectName(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/, '');
  return basename(trimmed.replace(/\\/g, '/')) || trimmed;
}
