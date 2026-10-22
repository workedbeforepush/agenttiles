// Recent sessions from the transcripts, starting new or resumed sessions in a terminal tab, and the claude CLI for
// background sessions.
import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { LaunchView, RecentProject, RecentSession } from '../core/types';
import { claudeDir, projectName } from '../core/paths';
import { parseSessionHead, parseSessionTail } from '../core/recent';
import { promptText } from '../core/transcript';
import { clipText } from '../core/tools';
import { cleanEnv } from './env';
import { openTerminal } from './platform';
import { log } from './log';
import { t } from './i18n';

const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 256 * 1024;
/** Newest transcripts looked at; older sessions are rarely resumed from a dashboard. */
const CANDIDATES = 150;
const MAX_SESSIONS = 40;
const MAX_PROJECTS = 20;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOB_ID = /^[0-9a-f]{8}$/i;

async function readRange(path: string, size: number): Promise<{ head: string; tail: string }> {
  const handle = await open(path, 'r');
  try {
    const head = Buffer.alloc(Math.min(size, HEAD_BYTES));
    await handle.read(head, 0, head.length, 0);
    const tailLength = Math.min(size, TAIL_BYTES);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, size - tailLength);
    return { head: head.toString('utf8'), tail: tail.toString('utf8') };
  } finally {
    await handle.close();
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Recent interactive sessions, newest first, and their project folders. `running` sessions are left out of the
 * resume list (they are tiles already) but still count for the projects.
 */
export async function recentSessions(running: Set<string>): Promise<LaunchView> {
  const root = join(claudeDir(), 'projects');
  if (!existsSync(root)) return { projects: [], sessions: [] };
  const files: { path: string; sessionId: string; size: number; mtime: number }[] = [];
  for (const dir of await readdir(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const folder = join(root, dir.name);
    for (const name of await readdir(folder)) {
      const sessionId = name.replace(/\.jsonl$/, '');
      if (sessionId === name || !SESSION_ID.test(sessionId)) continue;
      try {
        const info = await stat(join(folder, name));
        files.push({ path: join(folder, name), sessionId, size: info.size, mtime: info.mtimeMs });
      } catch {
        // deleted meanwhile
      }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);

  const sessions: RecentSession[] = [];
  const projects = new Map<string, RecentProject>();
  for (const file of files.slice(0, CANDIDATES)) {
    try {
      const { head, tail } = await readRange(file.path, file.size);
      const info = parseSessionHead(head);
      if (!info || info.entrypoint !== 'cli' || !isDirectory(info.cwd)) continue;
      const key = process.platform === 'win32' ? info.cwd.toLowerCase() : info.cwd;
      if (!projects.has(key)) projects.set(key, { cwd: info.cwd, project: projectName(info.cwd), lastAt: file.mtime });
      if (running.has(file.sessionId) || sessions.length >= MAX_SESSIONS) continue;
      const end = parseSessionTail(tail);
      const prompt = end.lastPrompt ? promptText(end.lastPrompt) : null;
      sessions.push({
        sessionId: file.sessionId,
        cwd: info.cwd,
        project: projectName(info.cwd),
        title: end.title ?? (prompt ? clipText(prompt.replace(/\s+/g, ' '), 80) : t('main.launch.untitled')),
        lastAt: file.mtime,
      });
    } catch (error) {
      log.debug(`recent session ${file.path}: ${(error as Error).message}`);
    }
  }
  return { projects: [...projects.values()].slice(0, MAX_PROJECTS), sessions };
}

/** Worktree name characters: no spaces, no leading dash or dot. */
const WORKTREE_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

/**
 * A worktree name Claude Code can turn into a folder and branch: the characters above and git's ref name rules that
 * they still allow (no "..", no empty component, no component starting with a dot or ending in ".lock", no trailing
 * dot).
 */
function isWorktreeName(name: string): boolean {
  if (!WORKTREE_NAME.test(name) || name.includes('..') || name.endsWith('.')) return false;
  return name.split('/').every((part) => part !== '' && !part.startsWith('.') && !part.endsWith('.lock'));
}

/**
 * The claude command line: resume `sessionId` (with `fork`, as a new session with a copy of its conversation), or
 * start fresh; `worktree` (a name, or '' for one Claude picks) starts the new session in its own git worktree. Throws
 * with a message for the user on invalid input.
 */
export function launchCommand(sessionId: string | null, worktree: string | null, fork: boolean): string[] {
  if (sessionId !== null && !SESSION_ID.test(sessionId)) throw new Error(t('main.launch.invalidSessionId'));
  if (fork && sessionId === null) throw new Error(t('main.invalidRequest'));
  if (worktree !== null && worktree !== '' && !isWorktreeName(worktree)) {
    throw new Error(t('main.launch.invalidWorktree', { name: worktree }));
  }
  if (sessionId !== null) return ['claude', '--resume', sessionId, ...(fork ? ['--fork-session'] : [])];
  if (worktree === null) return ['claude'];
  return worktree === '' ? ['claude', '--worktree'] : ['claude', '--worktree', worktree];
}

/** Starts `claude` in a new terminal tab (see `launchCommand`). Throws with a message for the user. */
export async function launchSession(
  cwd: string,
  sessionId: string | null,
  worktree: string | null,
  fork: boolean,
): Promise<void> {
  if (!isDirectory(cwd)) throw new Error(t('main.launch.folderNotFound', { path: cwd }));
  const command = launchCommand(sessionId, worktree, fork);
  const result = await openTerminal(cwd, command, cleanEnv());
  if (result === 'unsupported') throw new Error(t('main.launch.startUnsupported'));
  if (result === 'failed') throw new Error(t('main.launch.noTerminal'));
  log.info(`launched ${command.join(' ')} in ${cwd}`);
}

/** Runs the claude CLI and returns its stdout. */
export function runClaude(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('claude', args, { encoding: 'utf8', windowsHide: true, timeout: 15_000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

/** Command that opens a background session in a terminal; throws on an id that is not a job id. */
export function attachCommand(jobId: string): string[] {
  if (!JOB_ID.test(jobId)) throw new Error(t('main.launch.invalidJobId'));
  return ['claude', 'attach', jobId];
}

/** Opens a background session (`claude attach`) in a new terminal tab. Throws with a message for the user. */
export async function attachSession(cwd: string, jobId: string): Promise<void> {
  if (!isDirectory(cwd)) throw new Error(t('main.launch.folderNotFound', { path: cwd }));
  const command = attachCommand(jobId);
  const result = await openTerminal(cwd, command, cleanEnv());
  if (result === 'unsupported') throw new Error(t('main.launch.attachUnsupported'));
  if (result === 'failed') throw new Error(t('main.launch.noTerminal'));
  log.info(`launched ${command.join(' ')}`);
}

/** Stops a background session (`claude stop`). */
export async function stopSession(jobId: string): Promise<void> {
  if (!JOB_ID.test(jobId)) throw new Error(t('main.launch.invalidJobId'));
  await runClaude(['stop', jobId]);
  log.info(`stopped background session ${jobId}`);
}
