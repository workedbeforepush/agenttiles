import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { parseHead, readGitBranch } from '../src/main/git';

const root = mkdtempSync(join(tmpdir(), 'agenttiles-git-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function repo(name: string, head: string): string {
  const dir = join(root, name);
  mkdirSync(join(dir, '.git'), { recursive: true });
  writeFileSync(join(dir, '.git', 'HEAD'), head);
  return dir;
}

describe('git branch', () => {
  it('parses HEAD contents', () => {
    expect(parseHead('ref: refs/heads/main\n')).toBe('main');
    expect(parseHead('ref: refs/heads/feature/login\n')).toBe('feature/login');
    expect(parseHead('3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39\n')).toBe('3f2a9c1');
    expect(parseHead('garbage')).toBeNull();
  });

  it('reads the branch of the repository containing the working directory, also without commits', () => {
    const dir = repo('unborn', 'ref: refs/heads/main\n');
    mkdirSync(join(dir, 'src', 'deep'), { recursive: true });
    expect(readGitBranch(join(dir, 'src', 'deep'))).toBe('main');
  });

  it('follows a worktree .git file', () => {
    const main = repo('main-repo', 'ref: refs/heads/main\n');
    const wtGit = join(main, '.git', 'worktrees', 'wt');
    mkdirSync(wtGit, { recursive: true });
    writeFileSync(join(wtGit, 'HEAD'), 'ref: refs/heads/worktree-feature\n');
    const worktree = join(root, 'wt');
    mkdirSync(worktree);
    writeFileSync(join(worktree, '.git'), `gitdir: ${wtGit}\n`);
    expect(readGitBranch(worktree)).toBe('worktree-feature');
  });

  it('notices a branch switch', () => {
    const dir = repo('switch', 'ref: refs/heads/main\n');
    expect(readGitBranch(dir)).toBe('main');
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/develop\n');
    const later = new Date(Date.now() + 5000);
    utimesSync(join(dir, '.git', 'HEAD'), later, later);
    expect(readGitBranch(dir)).toBe('develop');
  });

  it('returns null outside a repository', () => {
    const plain = join(root, 'plain');
    mkdirSync(plain);
    // The temp directory itself is not inside a repository on a normal machine.
    expect(readGitBranch(plain)).toBeNull();
  });

  it('notices a git init in a folder that was no repository, after a while', () => {
    const later = join(root, 'init-later');
    mkdirSync(later);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      expect(readGitBranch(later)).toBeNull();
      mkdirSync(join(later, '.git'));
      writeFileSync(join(later, '.git', 'HEAD'), 'ref: refs/heads/main\n');
      // Not looked up on every refresh.
      expect(readGitBranch(later)).toBeNull();
      clock.mockReturnValue(now + 60_000);
      expect(readGitBranch(later)).toBe('main');
    } finally {
      clock.mockRestore();
    }
  });
});
