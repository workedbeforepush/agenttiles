# Contributing to ccdash

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Before you start

- **Bugs:** open an [issue](https://github.com/workedbeforepush/ccdash/issues/new/choose) with the bug template.
  The Diagnostics panel (the pulse icon in the header) and the log in ccdash's data folder (`%APPDATA%\ccdash\ccdash.log`
  on Windows) usually show what went wrong. Remove project names or paths you don't want to share.
- **Features:** open an issue or a discussion first for anything bigger than a small fix, so we can agree on the
  approach before you spend time on it.
- **Security issues:** never in public issues. See [SECURITY.md](SECURITY.md).

## Setup

Requirements: Node.js 22 or later, and Claude Code for trying things out.

```sh
git clone https://github.com/workedbeforepush/ccdash.git
cd ccdash
npm install
npm run dev
```

ccdash combines four data sources: Claude Code's session registry (`~/.claude/sessions`), the transcripts, the
optional command hooks and the optional statusline wrapper. `src/core/session.ts` merges them into one state per
session; `src/main/store.ts` feeds it; the README section "How it works" gives the overview.

## Project layout

```
src/
  core/       pure logic shared by main, hook and renderer (state model, parsing, diff); no Electron imports
  hook/       ccdash-hook.js, the command hook and statusline wrapper Claude Code runs
  main/       Electron main process: IPC server, session store, tray, toasts, focus jump, settings
  preload/    the API the renderer gets as window.ccdash
  renderer/   Svelte 5 UI
test/         vitest tests
scripts/      build helpers and the screenshot generator
```

## Guidelines

- **Small, focused changes.** One topic per pull request.
- **Keep it simple.** One clear way to do a thing; no speculative options or fallbacks.
- **Fail open towards Claude Code.** Nothing ccdash does may block or break a Claude Code session. If ccdash is
  gone or confused, the hook steps aside and the terminal asks as usual.
- **Respect privacy.** Everything stays local. Never read credential files (for example the `.key` files in
  `~/.claude/sessions`).
- **Match the surrounding code**: naming, comment density and style. `.editorconfig` covers formatting basics.
- **Tests for logic.** Pure logic in `src/core` and `src/main` comes with vitest tests.
- **UI changes:** run `npm run screenshots` if a screenshot in the README changes, and include the updated images.

## Checks

Run these before you open a pull request; CI runs them too.

```sh
npm run typecheck
npm test
```

## Commit messages

Imperative mood, describing what the change does: "Add stats panel", "Fix focus jump across terminal windows".
A short body explains the why when it isn't obvious.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
