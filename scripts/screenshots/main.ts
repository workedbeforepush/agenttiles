// Renders README images from the real UI with demo data: run `npm run screenshots`.
// The real renderer and preload are loaded; this file stands in for AgentTiles's main process and answers its IPC
// channels with invented sessions (see demo.ts). Output goes to docs/images/.
import { BrowserWindow, app, ipcMain, nativeTheme, type NativeImage } from 'electron';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import type { DecisionRequest, SettingsPatch, SettingsView } from '../../src/core/types';
import { launchView, settingsView, snapshot, stats, type DemoProgress } from './demo';

const ROOT = resolve(__dirname, '../..');
const OUT = join(ROOT, 'docs', 'images');
const WIDTH = 1440;
const HEIGHT = 900;
/**
 * Screenshots at 1.5x so text stays sharp on high-density screens and when GitHub scales them down. Offscreen
 * rendering ignores the device scale factor, so the window is SCALE times larger and the page zoomed by SCALE.
 */
const SCALE = 1.5;
/**
 * The animation gets its own narrower window (three tile columns) and is rendered at its final size: scaling a
 * capture down blurs small text, which a 256-colour GIF then makes worse.
 */
const GIF_WIDTH = 960;
const GIF_HEIGHT = 680;
const GIF_SCALE = 1.25;
/** Frames closer together than this are skipped: smaller file, still smooth enough for a pointer moving. */
const GIF_FRAME_MS = 110;

// English dates and numbers whatever the machine's locale.
app.commandLine.appendSwitch('lang', 'en-US');
// Linux CI runs under a virtual display without a GPU; software rendering keeps captures working there.
if (process.platform === 'linux') app.disableHardwareAcceleration();
// Never touch the real AgentTiles data.
app.setPath('userData', mkdtempSync(join(tmpdir(), 'agenttiles-screenshots-')));

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let progress: DemoProgress = { approved: false, answered: false };
/** The page zoom in effect: SCALE, or less when the screen caps the window size (small CI runner screens). */
let zoom = SCALE;

/**
 * Sizes the window for a `width` x `height` CSS layout at `scale` and zooms the page to match. Windows caps
 * windows at the screen size, so the zoom follows the size the window really got: the layout stays the same.
 */
function fit(width: number, height: number, scale: number): void {
  win.setContentSize(Math.round(width * scale), Math.round(height * scale));
  const [w, h] = win.getContentSize() as [number, number];
  zoom = Math.min(w / width, h / height);
  win.webContents.setZoomFactor(zoom);
  if (zoom < scale) console.log(`window capped at ${w}x${h}: zoom ${zoom.toFixed(2)} instead of ${scale}`);
}
let settings: SettingsView = settingsView();
let win: BrowserWindow;

function push(): void {
  win.webContents.send('snapshot', snapshot(Date.now(), progress));
}

function registerIpc(): void {
  const view = (): SettingsView => settings;
  ipcMain.handle('snapshot:get', () => snapshot(Date.now(), progress));
  ipcMain.handle('settings:get', view);
  ipcMain.handle('settings:update', (_e, patch: SettingsPatch) => {
    const s = settings.settings;
    settings = { ...settings, settings: { ...s, ...patch, keys: { ...s.keys, ...patch.keys }, sounds: { ...s.sounds, ...patch.sounds } } };
    return settings;
  });
  for (const channel of ['integration:hooks', 'integration:statusline', 'firstrun:done', 'unhide:session', 'unhide:project']) {
    ipcMain.handle(channel, view);
  }
  for (const channel of ['tile:action', 'tile:rename', 'tiles:order', 'window:toggleFullscreen', 'sessions:launch', 'dialog:folder']) {
    ipcMain.handle(channel, () => null);
  }
  ipcMain.handle('permission:decide', (_e, _id: string, request: DecisionRequest) => {
    if (request.decision === 'allow') progress = { ...progress, approved: true };
    push();
    return true;
  });
  ipcMain.handle('permission:answer', () => {
    progress = { ...progress, answered: true };
    push();
    return true;
  });
  ipcMain.handle('window:isFullscreen', () => false);
  ipcMain.handle('limits:refresh', () => true);
  ipcMain.handle('icons:size', () => 24);
  ipcMain.on('status:icons', () => undefined);
  ipcMain.handle('stats:get', (_e, days: number) => stats(Date.now(), days === 30 ? 30 : 7));
  ipcMain.handle('sessions:recent', () => launchView(Date.now()));
  ipcMain.handle('doctor:run', () => null);
  ipcMain.handle('update:get', () => ({ current: '0.1.0', available: null, command: '', canInstall: false, failed: null, dismissed: false }));
  ipcMain.handle('update:run', () => null);
}

const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code) as Promise<T>;

/** Bottom edge of what is on screen (tiles, dialogs), so screenshots end below the content instead of the window. */
const CONTENT_BOTTOM = `Math.ceil(Math.max(...[...document.querySelectorAll('.tile, .dialog, .panel')].map((e) => e.getBoundingClientRect().bottom)) + 24)`;

/** The top `height` CSS pixels of a capture (captures with a rectangle fail with UnknownVizError on this setup). */
function cropTo(image: NativeImage, height: number, scale = zoom): NativeImage {
  const size = image.getSize();
  return image.crop({ x: 0, y: 0, width: size.width, height: Math.min(size.height, Math.round(height * scale)) });
}

async function capture(name: string): Promise<NativeImage> {
  await sleep(400);
  const bottom = Math.min(HEIGHT, await js<number>(CONTENT_BOTTOM));
  const image = cropTo(await win.webContents.capturePage(), bottom);
  writeFileSync(join(OUT, name), image.toPNG());
  console.log(`docs/images/${name}`);
  return image;
}

/** Polls until `check` (a JavaScript expression run in the page) is truthy; fails after 5 s (slow CI runners). */
async function waitFor(check: string, what: string): Promise<void> {
  const end = Date.now() + 5000;
  while (!(await js<boolean>(`!!(${check})`))) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

async function click(selector: string): Promise<void> {
  const query = `document.querySelector(${JSON.stringify(selector)})`;
  await waitFor(query, selector);
  await js(`${query}.click()`);
  await sleep(300);
}

/** Closes the open dialog with Esc, like a user would, and fails when it stays open. */
async function escape(): Promise<void> {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await waitFor(`!document.querySelector('.backdrop')`, 'Esc to close the dialog');
}

// ---- animated GIF -------------------------------------------------------------------------------------

/** A fake mouse pointer, so the animation shows where the click happens. */
const CURSOR = `(() => {
  const c = document.createElement('div');
  c.id = 'demo-cursor';
  c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l16 10-7 1.5L9.5 21z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  Object.assign(c.style, { position: 'fixed', left: '55%', top: '75%', zIndex: 9999, pointerEvents: 'none',
    transition: 'left 0.9s cubic-bezier(.4,0,.2,1), top 0.9s cubic-bezier(.4,0,.2,1), transform 0.12s' });
  document.body.appendChild(c);
})()`;

const moveTo = (selector: string): string => `(() => {
  const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
  const c = document.getElementById('demo-cursor');
  c.style.left = (r.left + r.width / 2 - 4) + 'px';
  c.style.top = (r.top + r.height / 2 - 2) + 'px';
})()`;

const PRESS = `(() => { const c = document.getElementById('demo-cursor'); c.style.transform = 'scale(0.8)'; setTimeout(() => c.style.transform = '', 140); })()`;

interface PendingFrame {
  rgba: Uint8Array;
  width: number;
  height: number;
  delay: number;
}

class Recorder {
  private readonly gif = GIFEncoder();
  private last = Date.now();
  /** The newest frame, written once the next one differs: identical frames merge into one longer frame. */
  private pending: PendingFrame | null = null;

  constructor(private readonly height: number) {}

  /** Captures frames for `ms`; each frame lasts until the next one. */
  async record(ms: number): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const started = Date.now();
      await this.frame();
      await sleep(Math.max(0, GIF_FRAME_MS - (Date.now() - started)));
    }
  }

  async frame(hold = 0): Promise<void> {
    const image = cropTo(await win.webContents.capturePage(), this.height);
    const { width, height } = image.getSize();
    const bgra = image.toBitmap();
    const rgba = new Uint8Array(bgra.length);
    for (let i = 0; i < bgra.length; i += 4) {
      rgba[i] = bgra[i + 2]!;
      rgba[i + 1] = bgra[i + 1]!;
      rgba[i + 2] = bgra[i]!;
      rgba[i + 3] = 255;
    }
    const now = Date.now();
    const delay = Math.max(40, now - this.last) + hold;
    this.last = now + hold;
    if (this.pending && Buffer.compare(this.pending.rgba, rgba) === 0) {
      this.pending.delay += delay;
      return;
    }
    this.flush();
    this.pending = { rgba, width, height, delay };
  }

  private flush(): void {
    const frame = this.pending;
    if (!frame) return;
    const palette = quantize(frame.rgba, 256);
    this.gif.writeFrame(applyPalette(frame.rgba, palette), frame.width, frame.height, { palette, delay: frame.delay });
    this.pending = null;
  }

  save(name: string): void {
    this.flush();
    this.gif.finish();
    writeFileSync(join(OUT, name), this.gif.bytes());
    console.log(`docs/images/${name}`);
  }
}

async function animation(): Promise<void> {
  progress = { approved: false, answered: false };
  fit(GIF_WIDTH, GIF_HEIGHT, GIF_SCALE);
  push();
  await sleep(1000);
  // Full window height: the question dialog in the second half of the story reaches below the first tile row.
  const rec = new Recorder(GIF_HEIGHT);
  await rec.frame(1200);
  await js(CURSOR);
  // 1. Allow an edit right on the tile.
  await js(moveTo('.tile.state-needsApproval .allow'));
  await rec.record(1000);
  await js(PRESS);
  await click('.tile.state-needsApproval .allow');
  await rec.record(1200);
  // 2. Answer a question in the dialog.
  await js(moveTo('.tile.state-needsInput .answer'));
  await rec.record(1000);
  await js(PRESS);
  await click('.tile.state-needsInput .answer');
  await rec.record(500);
  await js(moveTo('.dialog .option'));
  await rec.record(1000);
  await js(PRESS);
  await click('.dialog .option');
  await rec.record(500);
  await js(moveTo('.dialog .option'));
  await rec.record(900);
  await js(PRESS);
  await click('.dialog .option');
  await rec.record(400);
  await js(moveTo('.dialog .primary'));
  await rec.record(900);
  await js(PRESS);
  await click('.dialog .primary');
  await rec.record(1500);
  await rec.frame(1500);
  await js(`document.getElementById('demo-cursor').remove()`);
  rec.save('demo.gif');
}

// ---- social preview -----------------------------------------------------------------------------------

async function socialPreview(dashboard: NativeImage): Promise<void> {
  const shot = dashboard.resize({ width: 980, quality: 'best' }).toDataURL();
  const icon = `data:image/png;base64,${readFileSync(join(ROOT, 'resources', 'icon.png')).toString('base64')}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; width: 1280px; height: 640px; overflow: hidden; font-family: 'Segoe UI', sans-serif;
      background: radial-gradient(circle at 20% 20%, #23283a, #101217 70%); color: #e6e8ee; }
    .text { position: absolute; left: 72px; top: 84px; width: 520px; }
    .brand { display: flex; align-items: center; gap: 20px; }
    .brand img { width: 84px; height: 84px; }
    h1 { margin: 0; font-size: 76px; letter-spacing: -2px; }
    p { margin: 28px 0 0; font-size: 34px; line-height: 1.25; color: #c4c9d6; }
    ul { margin: 28px 0 0; padding: 0; list-style: none; font-size: 22px; color: #8b93a7; line-height: 1.7; }
    li::before { content: '●'; color: #ffb020; margin-right: 12px; font-size: 14px; vertical-align: middle; }
    .shot { position: absolute; left: 640px; top: 96px; width: 760px; border-radius: 14px;
      box-shadow: 0 30px 80px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(255 255 255 / 0.08); }
  </style></head><body>
    <div class="text">
      <div class="brand"><img src="${icon}"><h1>AgentTiles</h1></div>
      <p>Every Claude Code session on one screen.</p>
      <ul><li>Live status of all sessions</li><li>Allow, deny and answer from the dashboard</li><li>Plan limits, cost and stats</li></ul>
    </div>
    <img class="shot" src="${shot}">
  </body></html>`;
  const social = new BrowserWindow({ width: 1280, height: 640, show: false, useContentSize: true, webPreferences: { offscreen: true } });
  await social.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await sleep(800);
  const image = (await social.webContents.capturePage()).resize({ width: 1280, height: 640, quality: 'best' });
  writeFileSync(join(OUT, 'social-preview.png'), image.toPNG());
  console.log('docs/images/social-preview.png');
  social.destroy();
}

// ---- run ----------------------------------------------------------------------------------------------

async function run(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  nativeTheme.themeSource = 'dark';
  registerIpc();
  win = new BrowserWindow({
    width: WIDTH * SCALE,
    height: HEIGHT * SCALE,
    useContentSize: true,
    show: false,
    backgroundColor: '#15171c',
    // Offscreen: rendering does not depend on the user's screen (a covered or sleeping display breaks captures).
    webPreferences: { preload: join(ROOT, 'out', 'preload', 'index.js'), sandbox: true, contextIsolation: true, offscreen: true },
  });
  await win.loadFile(join(ROOT, 'out', 'renderer', 'index.html'));
  fit(WIDTH, HEIGHT, SCALE);
  await sleep(1500);

  const dashboard = await capture('dashboard.png');

  await click('.tile.state-needsApproval .review');
  await capture('review-diff.png');
  await escape();

  await click('.tile.state-needsInput .answer');
  await capture('question.png');
  await escape();

  await js(`[...document.querySelectorAll('.tile .answer')].find((b) => b.textContent.includes('Review plan')).click()`);
  await capture('plan.png');
  await escape();

  await click('.item.today');
  await js(`[...document.querySelectorAll('.tabs button')].find((b) => b.textContent.trim() === '30 days').click()`);
  await sleep(300);
  await js(`document.querySelectorAll('.bars')[0].children[24].dispatchEvent(new MouseEvent('mouseenter'))`);
  await capture('stats.png');
  await escape();

  await click('[aria-label="New session"]');
  await capture('new-session.png');
  await escape();

  await click('[aria-label="Group by project"]');
  await click('[aria-label="Toggle view"]');
  await capture('list-view.png');
  await click('[aria-label="Toggle view"]');
  await click('[aria-label="Group by project"]');

  await animation();
  await socialPreview(dashboard);
  app.quit();
}

app.whenReady().then(run).catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
