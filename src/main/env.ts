// Environment for Claude Code processes AgentTiles starts.

/**
 * The environment without Claude Code's own variables: AgentTiles may itself run inside a Claude session, and a child
 * marked as part of that session (CLAUDE_CODE_CHILD_SESSION and friends) does not register as a session of its own.
 */
export function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(CLAUDE|OPENCODE)/i.test(key)));
}
