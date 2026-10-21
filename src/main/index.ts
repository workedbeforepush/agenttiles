// Electron main process entry: wires store, IPC server, window, tray, toasts and renderer API.
import {
  app,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  nativeTheme,
  screen,
  shell,
  type BrowserWindow,
} from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENDPOINT_FILE_NAME, newEndpoint } from '../core/protocol';
import type {
  DecisionRequest,
  Settings,
  SettingsPatch,
  SettingsView,
  Snapshot,
  TileAction,
} from '../core/types';
import { ConfigStore, normaliseSettings } from './config';
import { DailyStats } from './daily';
import { LimitsCache } from './limits';
import { probeLimits } from './limitProbe';
import { runDoctor } from './doctor';
import { Integration } from './integration';
import { IpcServer } from './ipcServer';
import { initLog, log, setLogLevel } from './log';
import { Notifier } from './notifier';
import { Attention } from './attention';
import { launchSession, recentSessions } from './launcher';
import { focusSession, initPlatform, registerAppIdentity, setLinuxAutostart } from './platform';
import { APP_ID, APP_NAME, persistentIcons } from './appId';
import { SessionStore } from './store';
import { Updater } from './updater';
import { AppTray } from './tray';
import { createMainWindow } from './window';

// A bug in one callback must never take the dashboard down; log it and keep running.
process.on('uncaughtException', (error) => log.error('uncaught exception', error));
process.on('unhandledRejection', (reason) => log.error('unhandled rejection', reason));

const PRUNE_INTERVAL_MS = 10 * 60 * 1000;
/** Plan limits are queried at start and then on this interval (~600 tokens per query). */
const LIMIT_PROBE_INTERVAL_MS = 10 * 60 * 1000;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

if (process.argv.includes('--uninstall')) {
  // `agenttiles --uninstall`: remove hooks and statusline, print the result and exit (no window, no lock).
  void app.whenReady().then(uninstall);
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId(APP_ID);
  void app.whenReady().then(start).catch((error: unknown) => {
    log.error('startup failed', error);
    app.exit(1);
  });
}

function uninstall(): void {
  const userData = app.getPath('userData');
  initLog(userData, 'info');
  const integration = new Integration(userData, join(app.getAppPath(), 'out', 'hook', 'agenttiles-hook.js'));
  integration.setStatusline(false);
  integration.setHooks(false, 0);
  const status = integration.status(0);
  if (status.error) {
    console.error(`AgentTiles could not update ~/.claude/settings.json: ${status.error}`);
    app.exit(1);
    return;
  }
  console.log('AgentTiles hooks and statusline removed from ~/.claude/settings.json.');
  console.log('You can now run: npm uninstall -g agenttiles');
  app.exit(0);
}

async function start(): Promise<void> {
  const userData = app.getPath('userData');
  const config = new ConfigStore(userData);
  initLog(userData, config.config.settings.logLevel);
  log.info(`AgentTiles ${app.getVersion()} starting, userData ${userData}`);
  await initPlatform();
  const icons = persistentIcons(userData);
  registerAppIdentity(APP_ID, APP_NAME, icons.png);

  const daily = new DailyStats(userData);
  const integration = new Integration(userData, join(app.getAppPath(), 'out', 'hook', 'agenttiles-hook.js'));
  const settings = (): Settings => config.config.settings;
  let quitting = false;
  let snapshot: Snapshot = {
    tiles: [],
    header: {
      working: 0,
      waiting: 0,
      done: 0,
      fiveHour: null,
      sevenDay: null,
      fiveHourEta: null,
      today: { sessions: 0, turns: 0, workingMs: 0, waitingMs: 0, costUsd: 0 },
    },
  };

  const win: BrowserWindow = createMainWindow(config, () => !quitting, icons.ico);
  const showWindow = (): void => {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };

  const notifier = new Notifier(
    settings,
    () => win.isVisible() && win.isFocused(),
    (sessionId) => void focus(sessionId),
  );

  const attention = new Attention();

  // The store needs the IPC server to answer permission holds; the server needs the store for its handlers.
  let ipc: IpcServer | null = null;
  const store = new SessionStore(config, daily, new LimitsCache(userData), (id, decision, extras) => ipc?.reply(id, decision, extras) ?? false, {
    snapshot: (next) => {
      snapshot = next;
      if (!win.isDestroyed()) win.webContents.send('snapshot', next);
      const nudges = attention.check(next.tiles, Date.now(), settings());
      if (nudges.length === 0) return;
      notifier.nudge(nudges);
      // Sound cue: a reminder replays the cue of the state it waits in.
      const cues = nudges.map((n) => (n.kind === 'contextFull' ? 'contextFull' : n.tile.state));
      if (!win.isDestroyed()) win.webContents.send('transitions', cues);
    },
    transitions: (list) => {
      notifier.notify(list);
      if (!win.isDestroyed()) win.webContents.send('transitions', list.map((t) => t.state));
    },
    configChanged: () => {
      log.info('Claude Code configuration changed');
      if (!win.isDestroyed()) win.webContents.send('settings-changed');
    },
  });
  // Fresh random endpoint and token on every start; unix sockets live in a directory only the user can enter.
  const ipcDir = join(userData, 'ipc');
  mkdirSync(ipcDir, { recursive: true, mode: 0o700 });
  const endpoint = newEndpoint(ipcDir);
  writeFileSync(join(userData, ENDPOINT_FILE_NAME), JSON.stringify(endpoint), { mode: 0o600 });
  ipc = new IpcServer(endpoint, {
    onEvent: (payload, ts) => store.handleEvent(payload, ts),
    onStatusline: (payload) => store.handleStatusline(payload),
    onPermission: (id, payload, ts) => store.handlePermission(id, payload, ts),
    onPermissionGone: (id) => store.permissionGone(id),
  });
  const server = ipc;

  async function focus(sessionId: string): Promise<void> {
    const rec = store.record(sessionId);
    if (!rec?.registry) return;
    const reg = rec.registry;
    const titles = [
      reg.name && reg.nameSource !== 'derived' ? reg.name : null,
      rec.transcript.aiTitle,
    ].filter((t): t is string => t !== null);
    const result = await focusSession(rec.sessionId, reg.pid, titles);
    if (result === 'unsupported') notifier.info('AgentTiles', 'Focus jump is not supported on this OS.');
    else if (result === 'noX11') notifier.info('AgentTiles', 'Focus jump needs an X11 session; Wayland does not let apps raise windows.');
    else if (result === 'noXdotool') notifier.info('AgentTiles', 'Focus jump needs xdotool. Install it with your package manager.');
    else if (result === 'notFound') notifier.info('AgentTiles', `No terminal window found for ${rec.sessionId}.`);
  }

  function applyHotkey(): void {
    globalShortcut.unregisterAll();
    const s = settings();
    if (!s.hotkeyEnabled) return;
    let ok = false;
    try {
      ok = globalShortcut.register(s.hotkey, () => (win.isVisible() && win.isFocused() ? win.hide() : showWindow()));
    } catch (error) {
      // An invalid accelerator string throws; it must not stop the app from starting.
      log.warn(`global hotkey ${s.hotkey} is invalid: ${(error as Error).message}`);
    }
    if (!ok) {
      log.warn(`global hotkey ${s.hotkey} could not be registered`);
      notifier.info('AgentTiles', `Hotkey ${s.hotkey} is not available.`);
    }
  }

  function applySettings(previous: Settings | null): void {
    const s = settings();
    nativeTheme.themeSource = s.theme;
    win.setAlwaysOnTop(s.alwaysOnTop);
    setLogLevel(s.logLevel);
    if (process.platform === 'linux') {
      // --no-sandbox like the agenttiles command: npm installs cannot set up Chromium's SUID sandbox helper.
      setLinuxAutostart(s.autostart, [process.execPath, ...(app.isPackaged ? [] : [app.getAppPath()]), '--no-sandbox']);
    } else {
      // From npm or source, the executable is Electron itself: it needs the app folder as argument.
      app.setLoginItemSettings({ openAtLogin: s.autostart, path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] });
    }
    if (!previous || previous.hotkeyEnabled !== s.hotkeyEnabled || previous.hotkey !== s.hotkey) applyHotkey();
    if (previous && previous.permissionTimeoutSec !== s.permissionTimeoutSec) {
      integration.repair(s.permissionTimeoutSec);
    }
  }

  const settingsView = (): SettingsView => ({
    version: app.getVersion(),
    settings: settings(),
    hiddenProjects: config.config.hiddenProjects,
    hiddenSessions: store.hiddenSessionList(),
    integration: integration.status(settings().permissionTimeoutSec),
    firstRun: !config.config.firstRunDone,
    platform: process.platform,
  });

  const tray = new AppTray({
    toggle: () => (win.isVisible() ? win.hide() : showWindow()),
    show: showWindow,
    settings: () => {
      showWindow();
      win.webContents.send('open-settings');
    },
    quit: () => app.quit(),
  });

  ipcMain.handle('snapshot:get', () => snapshot);
  ipcMain.handle('settings:get', () => settingsView());
  ipcMain.handle('settings:update', (_e, patch: SettingsPatch) => {
    const previous = settings();
    config.config.settings = normaliseSettings({
      ...previous,
      ...patch,
      keys: { ...previous.keys, ...patch.keys },
      sounds: { ...previous.sounds, ...patch.sounds },
    });
    config.save();
    applySettings(previous);
    return settingsView();
  });
  ipcMain.handle('integration:hooks', (_e, enabled: boolean) => {
    integration.setHooks(enabled, settings().permissionTimeoutSec);
    return settingsView();
  });
  ipcMain.handle('integration:statusline', (_e, enabled: boolean) => {
    integration.setStatusline(enabled);
    return settingsView();
  });
  ipcMain.handle('firstrun:done', () => {
    config.config.firstRunDone = true;
    config.save();
    return settingsView();
  });
  ipcMain.handle('unhide:session', (_e, sessionId: string) => {
    store.unhideSession(sessionId);
    return settingsView();
  });
  ipcMain.handle('unhide:project', (_e, path: string) => {
    config.config.hiddenProjects = config.config.hiddenProjects.filter((p) => p !== path);
    config.save();
    store.changed();
    return settingsView();
  });
  ipcMain.handle('tile:action', async (_e, sessionId: string, action: TileAction) => {
    const rec = store.record(sessionId);
    if (!rec) return;
    const c = config.config;
    switch (action) {
      case 'focus':
        await focus(sessionId);
        return;
      case 'pin':
        if (!c.pins.includes(sessionId)) c.pins = [...c.pins, sessionId];
        break;
      case 'unpin':
        c.pins = c.pins.filter((id) => id !== sessionId);
        break;
      case 'hideSession':
        store.hideSession(sessionId);
        return;
      case 'hideProject':
        if (!c.hiddenProjects.includes(rec.cwd)) c.hiddenProjects = [...c.hiddenProjects, rec.cwd];
        break;
      case 'openFolder':
        await shell.openPath(rec.cwd);
        return;
      case 'copySessionId':
        clipboard.writeText(sessionId);
        return;
    }
    config.save();
    store.changed();
  });
  ipcMain.handle('tile:rename', (_e, sessionId: string, name: string | null) => {
    const trimmed = name?.trim() ?? '';
    const { [sessionId]: _old, ...rest } = config.config.renames;
    config.config.renames = trimmed ? { ...rest, [sessionId]: trimmed } : rest;
    config.save();
    store.changed();
  });
  ipcMain.handle('permission:answer', (_e, id: string, answers: unknown) => {
    if (typeof id !== 'string' || !answers || typeof answers !== 'object' || Array.isArray(answers)) return false;
    const clean = Object.fromEntries(
      Object.entries(answers as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'),
    );
    const ok = store.answerQuestion(id, clean);
    log.info(`question ${id}: ${ok ? 'answered' : 'answer rejected'} from AgentTiles`);
    return ok;
  });
  ipcMain.handle('permission:decide', (_e, id: string, request: DecisionRequest) => {
    if (typeof id !== 'string' || !request || !['allow', 'deny'].includes(request.decision)) return false;
    const clean: DecisionRequest = {
      decision: request.decision,
      always: request.always === true,
      ...(typeof request.message === 'string' ? { message: request.message } : {}),
    };
    const ok = store.decide(id, clean);
    log.info(`permission ${id}: ${clean.decision}${clean.always ? ' always' : ''} from AgentTiles${ok ? '' : ' (gone)'}`);
    return ok;
  });
  ipcMain.handle('tiles:order', (_e, ids: string[]) => {
    config.config.order = ids.filter((id) => typeof id === 'string');
    config.save();
    store.changed();
  });
  ipcMain.handle('sessions:recent', () => recentSessions(new Set(snapshot.tiles.map((t) => t.sessionId))));
  ipcMain.handle('sessions:launch', async (_e, cwd: unknown, sessionId: unknown) => {
    if (typeof cwd !== 'string' || (sessionId !== null && typeof sessionId !== 'string')) return 'Invalid request.';
    try {
      await launchSession(cwd, sessionId);
      return null;
    } catch (error) {
      log.warn(`launch failed: ${(error as Error).message}`);
      return (error as Error).message;
    }
  });
  ipcMain.handle('dialog:folder', async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle('stats:get', (_e, days: number) => store.stats(days === 30 ? 30 : 7));
  ipcMain.handle('window:toggleFullscreen', () => win.setFullScreen(!win.isFullScreen()));
  ipcMain.handle('window:isFullscreen', () => win.isFullScreen());
  win.on('enter-full-screen', () => win.webContents.send('fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen', false));
  /** The waiting count outside the window: taskbar overlay (Windows), Dock badge (macOS), launcher count (Linux). */
  function showWaitingCount(badgePng: string | null, count: number): void {
    if (process.platform === 'win32') {
      const badge = typeof badgePng === 'string' ? nativeImage.createFromDataURL(badgePng) : null;
      if (!win.isDestroyed()) win.setOverlayIcon(badge && !badge.isEmpty() ? badge : null, `${count} waiting`);
    } else if (process.platform === 'darwin') {
      app.dock?.setBadge(count > 0 ? String(count) : '');
    } else {
      app.setBadgeCount(count);
    }
  }

  ipcMain.handle('icons:size', () => Math.round(16 * screen.getPrimaryDisplay().scaleFactor));
  ipcMain.on('status:icons', (_e, trayPng: string, tooltip: string, badgePng: string | null, waiting: number) => {
    const trayImage = nativeImage.createFromDataURL(trayPng);
    if (!trayImage.isEmpty()) tray.setIcon(trayImage, tooltip);
    showWaitingCount(badgePng, typeof waiting === 'number' ? waiting : 0);
  });
  ipcMain.handle('doctor:run', () =>
    runDoctor(
      new Set(snapshot.tiles.map((t) => t.sessionId)),
      { listening: server.listening, path: server.path },
      integration.status(settings().permissionTimeoutSec),
    ),
  );

  app.on('second-instance', showWindow);
  // macOS: a click on the Dock icon brings the window back.
  app.on('activate', showWindow);
  app.on('before-quit', () => {
    quitting = true;
    server.stop();
    store.stop();
    globalShortcut.unregisterAll();
    tray.destroy();
  });
  app.on('window-all-closed', () => {
    // Keep running in the tray.
  });

  applySettings(null);
  integration.repair(settings().permissionTimeoutSec);
  try {
    await server.start();
  } catch (error) {
    log.error(`ipc server could not listen on ${server.path}`, error);
  }
  store.start();
  setTimeout(() => store.pruneConfig(), 10_000);
  setInterval(() => store.pruneConfig(), PRUNE_INTERVAL_MS);

  let probing: Promise<boolean> | null = null;
  /** One probe at a time; a click while a probe runs waits for that probe. */
  const probe = (): Promise<boolean> => {
    probing ??= (async () => {
      try {
        const limits = await probeLimits((pid, running) => store.ownProcess(pid, running));
        if (!limits) return false;
        log.debug(`limit probe: 5h ${limits.fiveHour?.usedPct ?? '-'}%, 7d ${limits.sevenDay?.usedPct ?? '-'}%`);
        store.updateLimits(limits);
        return true;
      } finally {
        probing = null;
      }
    })();
    return probing;
  };
  ipcMain.handle('limits:refresh', () => probe());

  const updater = new Updater(userData, app.getAppPath(), app.getVersion());
  const sendUpdate = (): void => {
    if (!win.isDestroyed()) win.webContents.send('update', updater.view());
  };
  const checkUpdate = (): Promise<void> => updater.check().then(sendUpdate);
  ipcMain.handle('update:get', () => updater.view());
  ipcMain.handle('update:run', async () => {
    const view = updater.view();
    if (view.available && view.canInstall && !view.failed) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'info',
        title: 'Update AgentTiles',
        message: `Update AgentTiles to ${view.available}?`,
        detail: `AgentTiles quits, runs "${view.command}" and starts again in a few seconds.`,
        buttons: ['Update and restart', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response !== 0) return;
      updater.install(view.available);
      quitting = true;
      app.quit();
      return;
    }
    const { response } = await dialog.showMessageBox(win, {
      type: view.failed ? 'warning' : 'info',
      title: 'Update AgentTiles',
      message: view.failed ? 'The last update did not work.' : `AgentTiles ${view.available ?? ''} is available.`,
      detail: `${view.failed ? `npm said:\n${view.failed}\n\n` : ''}Update in a terminal with:\n${view.command}`,
      buttons: ['Copy command', 'Close'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) clipboard.writeText(view.command);
  });
  void checkUpdate();
  setInterval(() => void checkUpdate(), UPDATE_CHECK_INTERVAL_MS);
  void probe();
  setInterval(() => void probe(), LIMIT_PROBE_INTERVAL_MS);
}
