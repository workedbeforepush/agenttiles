// Identity of AgentTiles on Windows: taskbar grouping, taskbar icon and the sender shown on toasts.
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';

/** Process id: registered in HKCU so toasts show "AgentTiles" with its icon. */
export const APP_ID = 'dev.agenttiles.app';
/**
 * Window id for the taskbar button. It must differ from the registered APP_ID: with the registered id Windows takes the
 * taskbar icon from that registration and falls back to electron.exe's icon; an unregistered id uses the relaunch icon
 * set via setAppDetails.
 */
export const WINDOW_APP_ID = 'dev.agenttiles.window';
export const APP_NAME = 'AgentTiles';

/** Multi-size ICO on Windows (taskbar, alt-tab), PNG elsewhere. Relative to the bundled out/main directory. */
export const APP_ICON = join(__dirname, '../../resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
export const APP_ICON_PNG = join(__dirname, '../../resources/icon.png');

/**
 * Copies of the icons in the userData folder, for what Windows remembers beyond this process: the taskbar relaunch
 * icon and the toast sender icon. Windows keeps the first path it saw per app id, and the bundled files move (a
 * renamed folder, an npm install under another Node version); the userData path does not.
 */
export function persistentIcons(userData: string): { ico: string; png: string } {
  const ico = join(userData, 'icon.ico');
  const png = join(userData, 'icon.png');
  copyFileSync(join(__dirname, '../../resources/icon.ico'), ico);
  copyFileSync(APP_ICON_PNG, png);
  return { ico, png };
}
