// Main window creation and bounds persistence (monitor, position, size, maximized).
import { BrowserWindow, app, screen } from 'electron';
import { join } from 'node:path';
import type { ConfigStore, WindowBounds } from './config';
import { APP_ICON, WINDOW_APP_ID } from './appId';

const SAVE_DEBOUNCE_MS = 500;

function onSomeDisplay(bounds: WindowBounds): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    );
  });
}

export function createMainWindow(config: ConfigStore, shouldHideOnClose: () => boolean): BrowserWindow {
  const saved = config.config.window;
  const usable = saved && onSomeDisplay(saved) ? saved : null;
  const win = new BrowserWindow({
    width: usable?.width ?? 1100,
    height: usable?.height ?? 720,
    ...(usable ? { x: usable.x, y: usable.y } : {}),
    minWidth: 260,
    minHeight: 200,
    show: false,
    title: 'AgentTiles',
    icon: APP_ICON,
    autoHideMenuBar: true,
    alwaysOnTop: config.config.settings.alwaysOnTop,
    backgroundColor: '#15171c',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (usable?.maximized) win.maximize();
  if (process.platform === 'win32') {
    const relaunch = app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${app.getAppPath()}"`;
    win.setAppDetails({
      appId: WINDOW_APP_ID,
      appIconPath: APP_ICON,
      relaunchCommand: relaunch,
      relaunchDisplayName: 'AgentTiles',
    });
  }

  let timer: NodeJS.Timeout | null = null;
  const save = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized()) return;
      const b = win.getNormalBounds();
      config.config.window = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() };
      config.save();
    }, SAVE_DEBOUNCE_MS);
  };
  win.on('move', save);
  win.on('resize', save);
  win.on('maximize', save);
  win.on('unmaximize', save);

  win.on('close', (event) => {
    if (!shouldHideOnClose()) return;
    event.preventDefault();
    win.hide();
  });

  win.once('ready-to-show', () => win.show());

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}
