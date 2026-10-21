// Identity of AgentTiles on Windows: taskbar grouping, taskbar icon and the sender shown on toasts.
import { join } from 'node:path';

/** Process id: registered in HKCU so toasts show "AgentTiles" with its icon. */
export const APP_ID = 'dev.agenttiles.app';
/**
 * Window id for the taskbar button. It must differ from the registered APP_ID: with the registered id Windows takes the
 * taskbar icon from that registration and falls back to electron.exe's icon; an unregistered id uses the relaunch icon
 * set via setAppDetails.
 */
export const WINDOW_APP_ID = 'dev.agenttiles.dashboard';
export const APP_NAME = 'AgentTiles';

/** Multi-size ICO on Windows (taskbar, alt-tab), PNG elsewhere. Relative to the bundled out/main directory. */
export const APP_ICON = join(__dirname, '../../resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
export const APP_ICON_PNG = join(__dirname, '../../resources/icon.png');
