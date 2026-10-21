# Security policy

AgentTiles sits between you and Claude Code's permission prompts, so security reports are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub:
[Report a vulnerability](https://github.com/workedbeforepush/agenttiles/security/advisories/new).

Include what you found, how to reproduce it and what an attacker could do with it. You will get an answer within
a week. Once a fix is released, you are credited in the advisory unless you prefer otherwise.

## Supported versions

Only the latest release (or the `main` branch, until releases exist) receives security fixes.

## Scope

Of particular interest:

- anything that lets another process or user **approve a permission request** or inject an answer
- the local IPC channel between the hook script and the app (named pipe / unix socket and its token)
- changes AgentTiles makes to `~/.claude/settings.json`
- rendering of untrusted text (prompts, replies, tool input, plans, diffs) in the dashboard

Out of scope: issues that need an attacker who can already run code as your user account, and vulnerabilities in
Claude Code itself (report those to [Anthropic](https://www.anthropic.com/responsible-disclosure-policy)).
