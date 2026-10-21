// Tray icon: the app icon plus a badge with the waiting count, painted by the renderer and sent as PNG.
import { Menu, Tray, nativeImage, type NativeImage } from 'electron';
import { APP_ICON_PNG } from './appId';

const SIZE = 32;

/** The plain app icon, shown until the renderer paints the first icon with a badge. */
function placeholderIcon(): NativeImage {
  return nativeImage.createFromPath(APP_ICON_PNG).resize({ width: SIZE, height: SIZE });
}

export interface TrayActions {
  toggle(): void;
  show(): void;
  settings(): void;
  quit(): void;
}

export class AppTray {
  private readonly tray: Tray;

  constructor(actions: TrayActions) {
    this.tray = new Tray(placeholderIcon());
    this.tray.setToolTip('ccdash');
    this.tray.on('click', () => actions.toggle());
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show', click: () => actions.show() },
        { label: 'Settings', click: () => actions.settings() },
        { type: 'separator' },
        { label: 'Quit', click: () => actions.quit() },
      ]),
    );
  }

  setIcon(image: NativeImage, tooltip: string): void {
    this.tray.setImage(image);
    this.tray.setToolTip(tooltip);
  }

  destroy(): void {
    this.tray.destroy();
  }
}
