#!/usr/bin/env node
// The `agenttiles` command of the npm package: starts the app in Electron, detached from the terminal.
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const electron = require('electron'); // path of the Electron binary the electron package downloaded
const { version } = require('../package.json');

const HELP = `AgentTiles ${version}: every running Claude Code session on one screen.

Usage:
  agenttiles               start AgentTiles (or bring the running one to the front)
  agenttiles --uninstall   remove AgentTiles' hooks and statusline from ~/.claude/settings.json
                           (run this before: npm uninstall -g agenttiles)
  agenttiles --version     print the version
  agenttiles --help        show this help`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}
if (args.includes('--version') || args.includes('-v')) {
  console.log(version);
  process.exit(0);
}

const app = join(__dirname, '..');
// Chromium's sandbox helper needs root (SUID) on many distributions, which an npm install cannot set up.
// AgentTiles only shows its own local files under a strict content security policy.
const platform = process.platform === 'linux' ? ['--no-sandbox'] : [];

if (args.includes('--uninstall')) {
  // In the foreground: the result is printed here.
  const child = spawn(electron, [app, ...platform, '--uninstall'], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 1));
} else {
  const child = spawn(electron, [app, ...platform], { detached: true, stdio: 'ignore' });
  child.unref();
}
