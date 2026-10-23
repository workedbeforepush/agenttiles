# Changelog

All notable changes to AgentTiles. Versions follow [Semantic Versioning](https://semver.org/); entries are written
by release-please from the pull request titles (conventional commits).

## [0.7.1](https://github.com/workedbeforepush/agenttiles/compare/v0.7.0...v0.7.1) (2026-10-23)


### Bug Fixes

* jump to the IDE window of the session's solution, not only its folder ([#45](https://github.com/workedbeforepush/agenttiles/issues/45)) ([8e52b56](https://github.com/workedbeforepush/agenttiles/commit/8e52b56eacf74ff258cc0fcb163ed1aa2fe50f2e))

## [0.7.0](https://github.com/workedbeforepush/agenttiles/compare/v0.6.1...v0.7.0) (2026-10-22)


### Features

* keep ended sessions as tiles with resume and fork ([#41](https://github.com/workedbeforepush/agenttiles/issues/41)) ([ddb851f](https://github.com/workedbeforepush/agenttiles/commit/ddb851f37c614e6f16a66eeb2585126a3e8c1764))

## [0.6.1](https://github.com/workedbeforepush/agenttiles/compare/v0.6.0...v0.6.1) (2026-10-22)


### Bug Fixes

* focus sessions that Windows handed to the default terminal ([#39](https://github.com/workedbeforepush/agenttiles/issues/39)) ([a816ad8](https://github.com/workedbeforepush/agenttiles/commit/a816ad83f730ae592797b00ca9077d6853223747))

### Thanks

* [@Janik135](https://github.com/Janik135) for [#39](https://github.com/workedbeforepush/agenttiles/pull/39), their first contribution

## [0.6.0](https://github.com/workedbeforepush/agenttiles/compare/v0.5.0...v0.6.0) (2026-10-22)


### Features

* announce new versions with a toast, a corner note and a changelog link ([#33](https://github.com/workedbeforepush/agenttiles/issues/33)) ([674b7bc](https://github.com/workedbeforepush/agenttiles/commit/674b7bc8fac19e7b40bc94760530674a0caa5bb1))
* jump to the exact tab in WezTerm, kitty and tmux ([#34](https://github.com/workedbeforepush/agenttiles/issues/34)) ([aa60f1d](https://github.com/workedbeforepush/agenttiles/commit/aa60f1dbc03b506dec033fa33123b57fcc125807))


### Bug Fixes

* stop showing "no hooks" for idle sessions after AgentTiles restarts ([#35](https://github.com/workedbeforepush/agenttiles/issues/35)) ([b2569f6](https://github.com/workedbeforepush/agenttiles/commit/b2569f610876a45c608be62ae60ae6c42d4ba6f6))

## [0.5.0](https://github.com/workedbeforepush/agenttiles/compare/v0.4.0...v0.5.0) (2026-10-22)


### Features

* count every session state in the header counters ([#31](https://github.com/workedbeforepush/agenttiles/issues/31)) ([c00bbf5](https://github.com/workedbeforepush/agenttiles/commit/c00bbf5a408417ad36dbd5ba6b1ed64ca3a146da))
* option to open new sessions in a new terminal window ([#26](https://github.com/workedbeforepush/agenttiles/issues/26)) ([fa450e9](https://github.com/workedbeforepush/agenttiles/commit/fa450e94deb75e5b298bec35e41ac8e5d7bb9235))
* show when the status filter hides sessions ([#30](https://github.com/workedbeforepush/agenttiles/issues/30)) ([263efde](https://github.com/workedbeforepush/agenttiles/commit/263efdea8c49e68fe7d96eb90d23eba8b00d1af1))
* start a new session in its own git worktree ([#24](https://github.com/workedbeforepush/agenttiles/issues/24)) ([0a17fae](https://github.com/workedbeforepush/agenttiles/commit/0a17faed6040244c20f67b07dc73926b58cbbb8f))


### Bug Fixes

* harden the hook connection and fix bugs found in a code review ([#32](https://github.com/workedbeforepush/agenttiles/issues/32)) ([bde709e](https://github.com/workedbeforepush/agenttiles/commit/bde709ee60e0cc125c5d87446383beb175e112ee))
* jump to the right Windows Terminal tab when its title has umlauts or other non-ASCII letters ([#25](https://github.com/workedbeforepush/agenttiles/issues/25)) ([8c7d804](https://github.com/workedbeforepush/agenttiles/commit/8c7d804ff0b390dd88cd24d6a11b97350ce30f18))
* show an idle session as idle again after Claude Code compacts it while idle ([#29](https://github.com/workedbeforepush/agenttiles/issues/29)) ([487d3cb](https://github.com/workedbeforepush/agenttiles/commit/487d3cbba24e20c6f0134b1b5d431f07e3db2744))

## [0.4.0](https://github.com/workedbeforepush/agenttiles/compare/v0.3.0...v0.4.0) (2026-10-22)


### Features

* prepare the UI for translations, with a language setting ([#21](https://github.com/workedbeforepush/agenttiles/issues/21)) ([11ea156](https://github.com/workedbeforepush/agenttiles/commit/11ea15690a268493d99064829654a628a1a7cff4))


### Bug Fixes

* softer, less robotic sound cues ([#22](https://github.com/workedbeforepush/agenttiles/issues/22)) ([4486a90](https://github.com/workedbeforepush/agenttiles/commit/4486a909a224a891afbb3e5dfd8bce3c6928bf1c))

## [0.3.0](https://github.com/workedbeforepush/agenttiles/compare/v0.2.0...v0.3.0) (2026-10-22)


### Features

* show background sessions as tiles ([#15](https://github.com/workedbeforepush/agenttiles/issues/15)) ([ba701c7](https://github.com/workedbeforepush/agenttiles/commit/ba701c7262afa1ed55225200b2ea58c82a6dfa78))
* tidy Settings into pages with switches ([#20](https://github.com/workedbeforepush/agenttiles/issues/20)) ([54bb3ac](https://github.com/workedbeforepush/agenttiles/commit/54bb3ac7e0a8bb39fba1eacc37daedcb63b6d92e))
* usage history from transcripts with per-model breakdown and CSV export ([#16](https://github.com/workedbeforepush/agenttiles/issues/16)) ([9017008](https://github.com/workedbeforepush/agenttiles/commit/901700852bfe1f5116c5e0cc99ec6b4071f3590a))
* welcome tour on first start, replayable from Settings ([#19](https://github.com/workedbeforepush/agenttiles/issues/19)) ([f549d41](https://github.com/workedbeforepush/agenttiles/commit/f549d419e9632f5f0d476b44c201304e8363ed1a))


### Bug Fixes

* jump to a Windows Terminal tab without waiting for PowerShell to start ([#17](https://github.com/workedbeforepush/agenttiles/issues/17)) ([71f810d](https://github.com/workedbeforepush/agenttiles/commit/71f810d46e954726f57c9f61c2b97be9c9d3fd1a))

## [0.2.0](https://github.com/workedbeforepush/agenttiles/compare/v0.1.0...v0.2.0) (2026-10-22)


### Features

* ask for the hooks at every start until installed, with Don't ask again ([#13](https://github.com/workedbeforepush/agenttiles/issues/13)) ([b5ff63a](https://github.com/workedbeforepush/agenttiles/commit/b5ff63aa231db0e52d7183c2af42d934d77f66f3))

## [0.1.0](https://github.com/workedbeforepush/agenttiles/releases/tag/v0.1.0) (2026-10-21)

First public version.

### Added

- Live tile per running Claude Code session, found through Claude Code's session registry, including sessions that
  were running before AgentTiles started.
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
- npm package: `npm install -g agenttiles`, then `agenttiles`; `agenttiles --uninstall` removes the hooks and the
  statusline. AgentTiles checks npm for new versions and updates itself after a click.
