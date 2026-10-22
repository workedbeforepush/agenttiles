// Tray icon: the app icon plus a badge with the waiting count, painted by the renderer and sent as PNG.
import { Menu, Tray, nativeImage, type NativeImage } from 'electron';
import { APP_ICON_PNG } from './appId';
import { t } from './i18n';

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

  constructor(private readonly actions: TrayActions) {
    this.tray = new Tray(placeholderIcon());
    this.tray.setToolTip('AgentTiles');
    this.tray.on('click', () => actions.toggle());
    this.updateMenu();
  }

  /** Builds the context menu in the current language; called again when the language changes. */
  updateMenu(): void {
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: t('tray.show'), click: () => this.actions.show() },
        { label: t('tray.settings'), click: () => this.actions.settings() },
        { type: 'separator' },
        { label: t('tray.quit'), click: () => this.actions.quit() },
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
