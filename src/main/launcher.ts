// Recent sessions from the transcripts, and starting new or resumed sessions in a terminal tab.
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

const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 256 * 1024;
/** Newest transcripts looked at; older sessions are rarely resumed from a dashboard. */
const CANDIDATES = 150;
const MAX_SESSIONS = 40;
const MAX_PROJECTS = 20;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
        title: end.title ?? (prompt ? clipText(prompt.replace(/\s+/g, ' '), 80) : 'Untitled session'),
        lastAt: file.mtime,
      });
    } catch (error) {
      log.debug(`recent session ${file.path}: ${(error as Error).message}`);
    }
  }
  return { projects: [...projects.values()].slice(0, MAX_PROJECTS), sessions };
}

/** Starts `claude` in a new terminal tab, resuming `sessionId` when given. Throws with a message for the user. */
export async function launchSession(cwd: string, sessionId: string | null): Promise<void> {
  if (!isDirectory(cwd)) throw new Error(`Folder not found: ${cwd}`);
  if (sessionId !== null && !SESSION_ID.test(sessionId)) throw new Error('Invalid session id.');
  const command = sessionId ? ['claude', '--resume', sessionId] : ['claude'];
  const result = await openTerminal(cwd, command, cleanEnv());
  if (result === 'unsupported') throw new Error('Starting sessions is supported on Windows (Windows Terminal) only.');
  if (result === 'failed') throw new Error('Windows Terminal (wt.exe) could not be started.');
  log.info(`launched ${command.join(' ')} in ${cwd}`);
}
