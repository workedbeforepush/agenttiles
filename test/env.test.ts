import { describe, expect, it } from 'vitest';
import { cleanEnv } from '../src/main/env';

describe('environment for started sessions', () => {
  it('drops the markers of a surrounding Claude session', () => {
    const env = cleanEnv({
      CLAUDECODE: '1',
      CLAUDE_PID: '4242',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_SESSION_ID: 'abc',
      CLAUDE_CODE_MESSAGING_TOKEN: 'secret',
      OPENCODE_SESSION: 'x',
      PATH: 'C:\\bin',
    });
    expect(env).toEqual({ PATH: 'C:\\bin' });
  });

  it("keeps the user's Claude configuration", () => {
    const user = {
      CLAUDE_CONFIG_DIR: 'D:\\claude-profile',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_OAUTH_TOKEN: 'token',
      CLAUDE_CODE_GIT_BASH_PATH: 'C:\\Git\\bin\\bash.exe',
    };
    expect(cleanEnv({ ...user, CLAUDECODE: '1' })).toEqual(user);
  });
});
