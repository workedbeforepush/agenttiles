# AGENTS.md

AgentTiles is an Electron + TypeScript + Svelte 5 desktop dashboard that shows every running Claude Code session on
one screen and lets the user approve, answer and jump to the session's terminal. Windows is the main platform;
macOS and Linux are experimental. The README has the feature overview; this file holds what the code does not say.

## Guardrails

- **Credentials stay unread.** `~/.claude/sessions/` holds `<pid>.json` registry files next to `<pid>.<hash>.key`
  credential files. Read only `<pid>.json` (see `isRegistryFileName`).
- **Claude Code never waits on AgentTiles.** Every hook path fails open: when the app is gone, slow or confused, the
  hook prints nothing (or `{}`) and exits 0, and the terminal asks as usual. Requests from hidden or print-mode
  sessions are passed back at once.
- **Approval is a deliberate click.** Allow / Always allow exist as buttons only; keyboard shortcuts deny or open,
  never approve.
- **Text from sessions is untrusted.** Prompts, replies, tool input, plans and diffs reach the DOM as text or through
  `markdownHtml`, which escapes first. Keep `{@html}` limited to that function's output.
- **Local only.** No telemetry, no server. Network use is the npm update check and the `claude -p` limit probe.
- **User data is the user's.** README images and tests use invented projects, paths and costs (see
  `scripts/screenshots/demo.ts`).

## Workflow

- `main` is protected: work on a branch, open a pull request, merge when every required check is green.
- Pull requests are squash-merged, so the **PR title is the commit** and release-please builds the version and the
  changelog from it. Titles are conventional commits written for users: `feat: start sessions in tmux`,
  `fix: focus the right tab across terminal windows`; `docs:`, `refactor:`, `test:`, `build:`, `ci:`, `chore:` for
  everything that ships no user-visible change.
- release-please owns `package.json`'s version, `CHANGELOG.md` and the tags; changes there come from its release PR.
- Plans, drafts and notes for the maintainer go into `private/` (git-ignored as a whole).
- Commit messages and PR descriptions describe the change only, without tool or AI attribution.

## Code

- `src/core` is pure logic shared by main, hook and renderer: no Electron, no I/O beyond what a function receives.
  `src/main` does the I/O; renderer modules that tests import (`keys.ts`, `layout.ts`, `markdown.ts`) stay DOM-free.
- One correct path per job: fail fast on broken preconditions, keep compatibility shims and fallbacks out. Code reads
  like its neighbours: same naming, same comment density, comments explain why.
- Logic in `src/core` and `src/main` comes with vitest tests. Platform helpers keep a pure part (parsing, script
  text, command building) next to the part that runs it, so the pure part is testable on any OS; `test/*-live.test.ts`
  runs the real thing on the macOS and Linux CI runners.
- Svelte 5 runes: send `$state.snapshot(value)` over IPC, and give IPC listeners a block body. An expression body
  returns the reactive proxy, which contextBridge fails to clone.
- `npm run typecheck` runs TypeScript 7 (`@typescript/native`) and svelte-check. The `typescript` package is
  TypeScript 6 on purpose: svelte-check needs it next to 7.
- UI changes: run `npm run screenshots` and commit the updated `docs/images` when a README image changes. The
  script renders the real UI offscreen with demo data and is also the CI smoke test.

## Known platform behaviour

Facts learned the hard way; check before building on the opposite.

- Claude Code runs `PermissionRequest` hooks in parallel with its own dialog; the first answer wins.
  `AskUserQuestion` goes through it too (answer with `allow` + `updatedInput.answers`). `ExitPlanMode` ignores a hook
  `allow`, and Claude treats a deny `message` as untrusted tool output, so plans are decided in the terminal.
- Background sessions (`claude --bg`) have a normal registry file with `"kind": "bg"` and a `jobId` (the id for
  `claude attach` / `claude stop`); their process stays alive while idle. More state lives in
  `~/.claude/jobs/<jobId>/state.json`.
- The registry `cwd` is the session's project folder; `CwdChanged` only reports `cd` inside the Bash tool.
- Windows remembers the first icon path per app id: icons Windows keeps (relaunch, toast) come from copies in the
  userData folder. Taskbar overlay icons are rescaled by Windows and stay soft; the crisp native badge needs package
  identity (MSIX).
- Electron hands Windows only the 1x tray and overlay image: paint them at the display's real pixel size.
- The `electron` package downloads its binary on the first `require` and prints that on stdout; the `agenttiles`
  command requires it only when it starts the app. `--uninstall` is plain Node: Electron can crash on Windows when it
  exits right after start without a window.
- Pull requests and tags created with `GITHUB_TOKEN` start no workflows; release-please uses the
  `RELEASE_PLEASE_TOKEN` secret so CI runs on its release PR.
