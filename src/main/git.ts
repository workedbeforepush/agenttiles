// Current git branch of a session's working directory, read from .git/HEAD.
// Claude Code records the branch once per session in the transcript and does not update it, so AgentTiles reads it itself.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

interface Cached {
  headPath: string;
  mtimeMs: number;
  branch: string | null;
}

const cache = new Map<string, Cached | null>();

/** Path of the HEAD file for the repository containing `cwd` (plain repo or worktree), or null outside a repo. */
function findHead(cwd: string): string | null {
  let dir = resolve(cwd);
  for (;;) {
    const dotGit = join(dir, '.git');
    if (existsSync(dotGit)) {
      if (statSync(dotGit).isDirectory()) return join(dotGit, 'HEAD');
      // Worktree or submodule: ".git" is a file "gitdir: <path>".
      const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'));
      if (!match?.[1]) return null;
      const gitDir = match[1].trim();
      return join(isAbsolute(gitDir) ? gitDir : resolve(dir, gitDir), 'HEAD');
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** "ref: refs/heads/main" -> "main"; a detached HEAD -> the short commit hash. */
export function parseHead(content: string): string | null {
  const text = content.trim();
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(text);
  if (ref?.[1]) return ref[1];
  return /^[0-9a-f]{7,64}$/i.test(text) ? text.slice(0, 7) : null;
}

/** The branch checked out in `cwd`, re-read only when HEAD changed. Null outside a git repository. */
export function readGitBranch(cwd: string): string | null {
  if (!cwd) return null;
  try {
    let entry = cache.get(cwd);
    if (entry === undefined) {
      const headPath = findHead(cwd);
      entry = headPath ? { headPath, mtimeMs: -1, branch: null } : null;
      cache.set(cwd, entry);
    }
    if (!entry) return null;
    const mtimeMs = statSync(entry.headPath).mtimeMs;
    if (mtimeMs !== entry.mtimeMs) {
      entry.branch = parseHead(readFileSync(entry.headPath, 'utf8'));
      entry.mtimeMs = mtimeMs;
    }
    return entry.branch;
  } catch {
    // Repository removed or HEAD unreadable: look it up again next time.
    cache.delete(cwd);
    return null;
  }
}
