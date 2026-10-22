// Environment for Claude Code processes AgentTiles starts.

/**
 * Variables a Claude Code session sets for its own child processes. A child that inherits them counts as part of that
 * session (CLAUDE_CODE_CHILD_SESSION and friends) and does not register as a session of its own.
 */
const SESSION_MARKERS = new Set([
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_ENV_FILE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SSE_PORT',
]);

/**
 * The environment without the markers of a Claude session AgentTiles may itself run in. The user's own configuration
 * (CLAUDE_CONFIG_DIR, CLAUDE_CODE_USE_BEDROCK, CLAUDE_CODE_OAUTH_TOKEN, ...) stays, so started sessions use the same
 * profile, provider and account as the user's terminal.
 */
export function cleanEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !SESSION_MARKERS.has(key.toUpperCase()) && !/^OPENCODE/i.test(key)),
  );
}
