// English messages of the tour area.

export const tour = {
  label: 'Welcome tour',
  steps: {
    welcome: {
      title: 'Welcome to AgentTiles',
      body: 'Every Claude Code session on one screen, so nothing ever waits on you unnoticed. Take the one-minute tour: the sessions you see now are made up, your real ones are untouched.',
    },
    counters: {
      title: 'Status at a glance',
      body: 'How many sessions are working, waiting for you or done. Click a counter to show only those tiles; click more to combine.',
    },
    banner: {
      title: 'Never miss a waiting session',
      body: 'Approvals, questions and plans line up here, longest waiting first. Press 1–9 to pick one, Enter to answer or jump, D to deny.',
    },
    tile: {
      title: 'One tile per session',
      body: 'Live activity, the last prompt and reply, branch, context and cost. Click a tile to land right in its terminal tab, click again to send it back.',
    },
    approve: {
      title: 'Approve right here',
      body: 'See exactly what Claude wants to run or change, open the diff, then Allow, Always or Deny. Approving is always a deliberate click, never a stray key press.',
    },
    limits: {
      title: 'Stay ahead of your limits',
      body: 'Your 5-hour and weekly plan usage, with a heads-up when the current pace would hit the limit before it resets. Click to check now.',
    },
    today: {
      title: 'Know what your day is worth',
      body: 'API-equivalent cost today. Click it for stats per day, project and model, read straight from your transcripts.',
    },
    newSession: {
      title: 'Start or pick up work',
      body: 'Open a new session in any recent project, or resume one that ended, in a fresh terminal tab.',
    },
    settings: {
      title: 'Make it yours',
      body: 'Tile size, sounds, keys, theme and more. This tour waits in Settings whenever you want to see it again.',
    },
    done: {
      title: "You're all set!",
      connected: 'AgentTiles is connected to Claude Code. Now go build something great.',
      connect:
        'One last step: connect AgentTiles to Claude Code. The hooks bring live tool activity and Allow / Deny on tiles, the statusline wrapper adds cost, context and plan limits.',
      connectHint: 'They go into {file}; your own hooks and statusline keep working. Settings can install or remove them any time.',
    },
  },
  stepOf: 'Step {step} of {count}',
  step: 'Step {step}',
  skip: 'Skip',
  start: 'Show me around →',
  back: 'Back',
  next: 'Next →',
  letsGo: "Let's go 🚀",
  notNow: 'Not now',
  installing: 'Installing…',
  install: 'Install hooks and statusline',
};
