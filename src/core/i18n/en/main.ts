// English messages of the main area.

export const main = {
  focus: {
    unsupported: 'Focus jump is not supported on this OS.',
    noX11: 'Focus jump needs an X11 session; Wayland does not let apps raise windows.',
    noXdotool: 'Focus jump needs xdotool. Install it with your package manager.',
    notFound: 'No terminal window found for {sessionId}.',
  },
  stopDialog: {
    title: 'Stop background session',
    message: 'Stop "{name}"?',
    detail: 'Runs "claude stop {jobId}". The conversation is kept; resume it from New session.',
    stop: 'Stop',
    cancel: 'Cancel',
    failed: 'claude stop {jobId} failed: {error}',
  },
  hotkeyUnavailable: 'Hotkey {hotkey} is not available.',
  invalidRequest: 'Invalid request.',
  exportDialog: {
    title: 'Export usage',
    csv: 'CSV',
  },
  waitingBadge: { one: '{count} waiting', other: '{count} waiting' },
  updateDialog: {
    title: 'Update AgentTiles',
    confirm: 'Update AgentTiles to {version}?',
    confirmDetail: 'AgentTiles quits, runs "{command}" and starts again in a few seconds.',
    updateAndRestart: 'Update and restart',
    later: 'Later',
    failed: 'The last update did not work.',
    available: 'AgentTiles {version} is available.',
    failedDetail: 'npm said:\n{output}\n\nUpdate in a terminal with:\n{command}',
    manualDetail: 'Update in a terminal with:\n{command}',
    copyCommand: 'Copy command',
    close: 'Close',
  },
  update: {
    npmNoInstall: 'npm did not install the update.',
  },
  launch: {
    untitled: 'Untitled session',
    folderNotFound: 'Folder not found: {path}',
    invalidSessionId: 'Invalid session id.',
    invalidWorktree: 'Not a valid worktree name: {name}. Use letters, digits, . _ / -',
    invalidJobId: 'Invalid background session id.',
    startUnsupported: 'Starting sessions is not supported on this OS.',
    attachUnsupported: 'Opening background sessions is not supported on this OS.',
    noTerminal: 'No terminal could be started (Windows Terminal, iTerm2 / Terminal.app, or a Linux terminal).',
  },
  integration: {
    nodeMissing: 'Node.js was not found in PATH. AgentTiles hooks need Node.js installed.',
    installHooksFailed: 'install hooks failed: {error}',
    uninstallHooksFailed: 'uninstall hooks failed: {error}',
    installStatuslineFailed: 'install statusline failed: {error}',
    uninstallStatuslineFailed: 'uninstall statusline failed: {error}',
  },
};
