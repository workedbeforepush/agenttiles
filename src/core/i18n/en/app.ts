// English messages of the app area.

export const app = {
  empty: {
    noSessions: 'No Claude Code sessions running.',
    noSessionsHint: 'Sessions appear here as soon as you start {code} in a terminal.',
    noMatch: 'No sessions match the filter.',
    showAll: 'Show all',
  },
  pager: {
    label: 'Pages',
    previous: 'Previous page',
    next: 'Next page',
    page: 'Page {page}',
    count: 'Page {page} / {pages}',
  },
  hookPrompt: {
    title: 'Connect AgentTiles to Claude Code',
    body: 'AgentTiles already shows every running session. Installing its hooks and statusline wrapper in {code} adds live tool activity, Allow / Deny on tiles, cost, context and rate limits.',
    hint: 'Existing hooks and statuslines are kept. Running sessions pick up the hooks when Claude Code reloads its settings. You can install or remove them any time in Settings.',
    never: "Don't ask again",
    notNow: 'Not now',
    installing: 'Installing…',
    install: 'Install hooks and statusline',
  },
  trayTooltip: 'AgentTiles · {working} working · {waiting} waiting · {done} done',
};
