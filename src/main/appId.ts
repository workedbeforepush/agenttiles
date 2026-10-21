// Identity of ccdash on Windows: taskbar grouping, taskbar icon and the sender shown on toasts.
import { join } from 'node:path';

/** Process id: registered in HKCU so toasts show "ccdash" with its icon. */
export const APP_ID = 'dev.ccdash.app';
/**
 * Window id for the taskbar button. It must differ from the registered APP_ID: with the registered id Windows takes the
 * taskbar icon from that registration and falls back to electron.exe's icon; an unregistered id uses the relaunch icon
 * set via setAppDetails.
 */
export const WINDOW_APP_ID = 'dev.ccdash.dashboard';
export const APP_NAME = 'ccdash';

/** Multi-size ICO on Windows (taskbar, alt-tab), PNG elsewhere. Relative to the bundled out/main directory. */
export const APP_ICON = join(__dirname, '../../resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
export const APP_ICON_PNG = join(__dirname, '../../resources/icon.png');
