# Changelog

All notable changes to ccdash are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

First public version.

### Added

- Live tile per running Claude Code session, found through Claude Code's session registry, including sessions that
  were running before ccdash started.
- Optional hooks: live tool activity, subagents, tasks, Allow / Always allow / Deny from the tile and the needs-you
  banner, answers to questions, read-only plan review.
- Diff preview for Edit, MultiEdit and Write requests, with an optional reason for Claude on deny.
- Optional statusline wrapper: cost, context use and plan limits; an existing statusline keeps working.
- 5-hour and 7-day plan limits with a forecast, refreshed every 10 minutes or on click.
- Needs-you banner, per-state sound cues with volume, toasts, reminders while a session waits, context warning.
- Tray icon and taskbar badge with the number of waiting sessions.
- Jump to the session's Windows Terminal tab (across windows), click again to minimize.
- Start new sessions and resume ended ones in a new Windows Terminal tab.
- Stats for today, 7 and 30 days, per day and per project.
- Status filter, grouping by project, list view, fixed tile sizes with paging, full screen.
- Configurable keyboard shortcuts, pin, rename, drag-and-drop order, hide sessions and projects.
- Diagnostics panel.
- macOS (experimental): jump to the exact tab in Terminal.app and iTerm2, other host apps come to the front; start
  and resume sessions in iTerm2 or Terminal.app; Dock badge; PATH taken from the login shell.
- Linux (experimental): jump to the terminal window on X11 with xdotool; start and resume sessions in the first
  installed terminal; launcher count; XDG autostart.

[Unreleased]: https://github.com/workedbeforepush/ccdash/commits/main
