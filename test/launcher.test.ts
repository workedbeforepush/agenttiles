import { describe, expect, it } from 'vitest';
import { launchCommand } from '../src/main/launcher';

describe('worktree names', () => {
  it('takes names git accepts as a branch', () => {
    for (const name of ['fix/login-42', 'feature/a.b', 'v1.2', 'a/b/c', 'my_tree']) {
      expect(launchCommand(null, name, false)).toEqual(['claude', '--worktree', name]);
    }
  });

  it('rejects names git refuses as a ref', () => {
    for (const name of ['a..b', 'a//b', 'a/', 'a.', 'x.lock', 'a/b.lock', 'a/../b', 'a/.hidden', '.a', '-a']) {
      expect(() => launchCommand(null, name, false), name).toThrow('Not a valid worktree name');
    }
  });
});
