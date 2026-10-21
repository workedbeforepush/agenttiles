// `agenttiles --uninstall`: removes AgentTiles' hooks and statusline from Claude Code's settings (restoring a
// statusline that was there before), so nothing is left behind after `npm uninstall -g agenttiles`.
// Plain Node, no Electron: it only edits files.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Integration } from '../main/integration';
import { PACKAGE } from '../main/updater';

/** Electron's userData folder of the app, where the hook script and the saved previous statusline live. */
function userDataDir(): string {
  if (process.platform === 'win32') return join(process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), PACKAGE);
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', PACKAGE);
  return join(process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config'), PACKAGE);
}

const integration = new Integration(userDataDir(), '');
integration.setStatusline(false);
integration.setHooks(false, 0);
const { error } = integration.status(0);
if (error) {
  console.error(`AgentTiles could not update Claude Code's settings.json: ${error}`);
  process.exit(1);
}
console.log("AgentTiles hooks and statusline removed from Claude Code's settings.json.");
console.log('You can now run: npm uninstall -g agenttiles');
