// English messages of the dialogs area.

export const dialogs = {
  close: 'Close',
  alreadyAnswered: 'Already answered or no longer waiting.',
  question: {
    ariaLabel: 'Answer question',
    kind: 'Question',
    tab: 'Q{n}',
    progress: '{step} / {total}',
    selectAll: 'Select all that apply',
    otherPlaceholder: 'Type something…',
    keys: '↑↓ select · 1–{rows} pick · Enter next · Esc close',
    back: 'Back',
    sending: 'Sending…',
    submit: 'Submit',
    next: 'Next',
  },
  review: {
    ariaPlan: 'Review plan',
    ariaChange: 'Review change',
    plan: 'Plan',
    truncated: 'Diff shortened; the terminal shows the full change.',
    feedbackPlaceholder: 'Tell Claude why, when you deny (optional)',
    planHint: 'Claude Code takes the plan decision only in its own dialog.',
    keys: 'Esc close',
    decideInTerminal: 'Decide in terminal',
    deny: 'Deny',
    alwaysAllow: 'Always allow',
    allow: 'Allow',
    alwaysHint: 'Always allow: {label}',
  },
};
