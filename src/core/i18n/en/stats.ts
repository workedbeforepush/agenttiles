// English messages of the stats area.

export const stats = {
  title: 'Stats',
  close: 'Close',
  range: {
    today: 'Today',
    days: { one: '{count} day', other: '{count} days' },
  },
  sessions: { one: 'sessions', other: 'sessions' },
  prompts: { one: 'prompts', other: 'prompts' },
  claudeWorking: 'Claude working',
  waitingForYou: 'waiting for you',
  apiEquivalent: 'API-equivalent',
  todayHint:
    'Working and waiting time add up across sessions, so they can exceed the wall clock. Prompts are counted from hook events only.',
  loadFailed: 'Stats could not be loaded.',
  costPerDay: 'API-equivalent cost per day',
  workingPerDay: 'Claude working per day',
  hours: '{value} h',
  barLabel: '{date}: {value}',
  column: {
    project: 'Project',
    model: 'Model',
    cost: 'Cost',
    prompts: 'Prompts',
    working: 'Working',
    waiting: 'Waiting',
    input: 'Input',
    output: 'Output',
    cacheWrite: 'Cache write',
    cacheRead: 'Cache read',
  },
  noActivity: 'No activity in this range yet.',
  noPrice: 'No price known for this model',
  source: 'Cost comes from the session transcripts; prompts and times are recorded while AgentTiles runs.',
  sourceSince:
    'Cost comes from the session transcripts; prompts and times are recorded while AgentTiles runs, data starts on {date}.',
  exportCsv: 'Export CSV',
  savedTo: 'Saved to {path}',
};
