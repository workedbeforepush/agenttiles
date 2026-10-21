import { describe, expect, it } from 'vitest';
import { hooksInstalled, installHooks } from '../src/core/hookConfig';
import { newRecord, toTile } from '../src/core/session';

const options = { nodePath: 'C:\\nodejs\\node.exe', hookPath: 'C:\\data\\agenttiles\\agenttiles-hook.js', permissionTimeoutSec: 600 };

describe('project folder and branch', () => {
  it('never shows the transcript placeholder "HEAD" as branch', () => {
    const rec = newRecord('s', 'C:\\not-a-repo', 0);
    rec.transcript.gitBranch = 'HEAD';
    expect(toTile(rec, { rename: null, pinned: false, branch: null }).git.branch).toBeNull();
    rec.transcript.gitBranch = 'feature/x';
    expect(toTile(rec, { rename: null, pinned: false, branch: null }).git.branch).toBe('feature/x');
  });

  it('reinstalls when an event from an older version still has an AgentTiles hook', () => {
    const current = installHooks({}, options);
    expect(hooksInstalled(current, options)).toBe(true);
    const hooks = current['hooks'] as Record<string, unknown[]>;
    const old = { ...current, hooks: { ...hooks, CwdChanged: hooks['Stop'] } };
    expect(hooksInstalled(old, options)).toBe(false);
    expect(Object.keys(installHooks(old, options)['hooks'] as object)).not.toContain('CwdChanged');
  });
});
