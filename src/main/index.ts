// Electron main process entry: wires store, IPC server, window, tray, toasts and renderer API.
import {
  app,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  nativeTheme,
  powerMonitor,
  screen,
  shell,
  type BrowserWindow,
} from 'electron';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENDPOINT_FILE_NAME, newEndpoint } from '../core/protocol';
import type {
  DecisionRequest,
  EndedAction,
  Settings,
  SettingsPatch,
  SettingsView,
  Snapshot,
  TileAction,
  UpdateView,
} from '../core/types';
import { ConfigStore, normaliseSettings } from './config';
import { DailyStats } from './daily';
import { UsageLog } from './usage';
import { usageCsv } from '../core/usage';
import { LimitsCache } from './limits';
import { EndedSessions } from './ended';
import { probeLimits } from './limitProbe';
import { runDoctor } from './doctor';
import { Integration } from './integration';
import { IpcServer } from './ipcServer';
import { initLog, log, setLogLevel } from './log';
import { Notifier } from './notifier';
import { Attention } from './attention';
import { attachSession, launchSession, recentSessions, stopSession } from './launcher';
import { focusSession, initPlatform, registerAppIdentity, setLinuxAutostart, setTerminalTarget } from './platform';
import { APP_ID, APP_NAME, persistentIcons } from './appId';
import { SessionStore } from './store';
import { Updater, releaseUrl, shouldAnnounce } from './updater';
import { AppTray } from './tray';
import { locale, setLocale, t } from './i18n';
import { resolveLocale } from '../core/i18n';
import { createMainWindow } from './window';

// A bug in one callback must never take the dashboard down; log it and keep running.
process.on('uncaughtException', (error) => log.error('uncaught exception', error));
process.on('unhandledRejection', (reason) => log.error('unhandled rejection', reason));

const PRUNE_INTERVAL_MS = 10 * 60 * 1000;
/** Plan limits are queried at start and then on this interval (~600 tokens per query). */
const LIMIT_PROBE_INTERVAL_MS = 10 * 60 * 1000;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId(APP_ID);
  void app.whenReady().then(start).catch((error: unknown) => {
    log.error('startup failed', error);
    // The log may not be open yet (a broken config.toml fails before it): tell the user directly.
    dialog.showErrorBox(t('main.startupFailed'), (error as Error).message);
    app.exit(1);
  });
}

async function start(): Promise<void> {
  // Windows looks up bare executable names (powershell.exe, wt.exe, npm, claude) in the current directory before PATH;
  // started as `agenttiles` from a cloned repo, that directory is not ours to trust.
  process.chdir(app.getPath('home'));
  const userData = app.getPath('userData');
  const config = new ConfigStore(userData);
  initLog(userData, config.config.settings.logLevel);
  log.info(`AgentTiles ${app.getVersion()} starting, userData ${userData}`);
  await initPlatform();
  const icons = persistentIcons(userData);
  registerAppIdentity(APP_ID, APP_NAME, icons.png);

  const daily = new DailyStats(userData);
  const usage = new UsageLog(userData);
  const integration = new Integration(userData, join(app.getAppPath(), 'out', 'hook', 'agenttiles-hook.js'));
  const settings = (): Settings => config.config.settings;
  let quitting = false;
  let snapshot: Snapshot = {
    tiles: [],
    ended: [],
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
  const store = new SessionStore(config, daily, usage, new LimitsCache(userData), new EndedSessions(userData), (id, decision, extras) => ipc?.reply(id, decision, extras) ?? false, {
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
  // mkdir's mode applies only when it creates the directory.
  chmodSync(ipcDir, 0o700);
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
    // A background session has no terminal window: open it in a new tab instead.
    if (reg.jobId !== null) {
      try {
        await attachSession(rec.cwd, reg.jobId);
      } catch (error) {
        log.warn(`attach failed: ${(error as Error).message}`);
        notifier.info('AgentTiles', (error as Error).message);
      }
      return;
    }
    const titles = [
      reg.name && reg.nameSource !== 'derived' ? reg.name : null,
      rec.transcript.aiTitle,
    ].filter((t): t is string => t !== null);
    const result = await focusSession(rec.sessionId, reg.pid, rec.cwd, titles);
    if (result === 'unsupported') notifier.info('AgentTiles', t('main.focus.unsupported'));
    else if (result === 'noX11') notifier.info('AgentTiles', t('main.focus.noX11'));
    else if (result === 'noXdotool') notifier.info('AgentTiles', t('main.focus.noXdotool'));
    else if (result === 'notFound') notifier.info('AgentTiles', t('main.focus.notFound', { sessionId: rec.sessionId }));
  }

  /** Resumes or forks a session from a tile; a failure is reported as a toast, as there is no dialog to show it. */
  async function launchFromTile(cwd: string, sessionId: string, fork: boolean): Promise<void> {
    try {
      await launchSession(cwd, sessionId, null, fork);
    } catch (error) {
      log.warn(`launch failed: ${(error as Error).message}`);
      notifier.info('AgentTiles', (error as Error).message);
    }
  }

  async function stopBackground(sessionId: string): Promise<void> {
    const jobId = store.record(sessionId)?.registry?.jobId;
    const name = snapshot.tiles.find((t) => t.sessionId === sessionId)?.name ?? sessionId;
    if (!jobId) return;
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: t('main.stopDialog.title'),
      message: t('main.stopDialog.message', { name }),
      detail: t('main.stopDialog.detail', { jobId }),
      buttons: [t('main.stopDialog.stop'), t('main.stopDialog.cancel')],
      defaultId: 1,
      cancelId: 1,
    });
    if (response !== 0) return;
    try {
      await stopSession(jobId);
    } catch (error) {
      log.warn(`stop failed: ${(error as Error).message}`);
      notifier.info('AgentTiles', t('main.stopDialog.failed', { jobId, error: (error as Error).message }));
    }
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
      notifier.info('AgentTiles', t('main.hotkeyUnavailable', { hotkey: s.hotkey }));
    }
  }

  function applySettings(previous: Settings | null): void {
    const s = settings();
    nativeTheme.themeSource = s.theme;
    const nextLocale = resolveLocale(s.language, app.getPreferredSystemLanguages());
    if (nextLocale !== locale()) {
      setLocale(nextLocale);
      tray.updateMenu();
    }
    win.setAlwaysOnTop(s.alwaysOnTop);
    setTerminalTarget(s.terminalTarget);
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

  // "Not now" closes the hook prompt until the next start.
  let hookPromptClosed = false;
  const settingsView = (): SettingsView => {
    const status = integration.status(settings().permissionTimeoutSec);
    return {
      version: app.getVersion(),
      settings: settings(),
      hiddenProjects: config.config.hiddenProjects,
      hiddenSessions: store.hiddenSessionList(),
      integration: status,
      askHooks: !status.hooksInstalled && !hookPromptClosed && !config.config.hookPromptOff && config.config.tourDone,
      showTour: !config.config.tourDone,
      locale: locale(),
      platform: process.platform,
    };
  };

  const tray = new AppTray({
    toggle: () => (win.isVisible() ? win.hide() : showWindow()),
    show: showWindow,
    settings: () => {
      showWindow();
      win.webContents.send('open-settings');
    },
    update: () => {
      showWindow();
      void runUpdate();
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
  ipcMain.handle('tour:done', () => {
    // The tour's last step offered the hooks: no second prompt in this run.
    hookPromptClosed = true;
    config.config.tourDone = true;
    config.save();
    return settingsView();
  });
  ipcMain.handle('hookprompt:close', (_e, forever: boolean) => {
    hookPromptClosed = true;
    if (forever) {
      config.config.hookPromptOff = true;
      config.save();
    }
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
      case 'fork':
        await launchFromTile(rec.cwd, sessionId, true);
        return;
      case 'stop':
        await stopBackground(sessionId);
        return;
    }
    config.save();
    store.changed();
  });
  ipcMain.handle('ended:action', async (_e, sessionId: string, action: EndedAction) => {
    const entry = store.endedSession(sessionId);
    if (!entry) return;
    switch (action) {
      case 'resume':
        await launchFromTile(entry.cwd, sessionId, false);
        return;
      case 'fork':
        await launchFromTile(entry.cwd, sessionId, true);
        return;
      case 'remove':
        store.removeEnded(sessionId);
        return;
      case 'openFolder':
        await shell.openPath(entry.cwd);
        return;
      case 'copySessionId':
        clipboard.writeText(sessionId);
        return;
    }
  });
  ipcMain.handle('tile:rename', (_e, sessionId: unknown, name: unknown) => {
    if (typeof sessionId !== 'string' || (name !== null && typeof name !== 'string')) return;
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
  ipcMain.handle('tiles:order', (_e, ids: unknown) => {
    if (!Array.isArray(ids)) return;
    config.config.order = ids.filter((id): id is string => typeof id === 'string');
    config.save();
    store.changed();
  });
  ipcMain.handle('sessions:recent', () => recentSessions(new Set(snapshot.tiles.map((t) => t.sessionId))));
  ipcMain.handle('sessions:launch', async (_e, cwd: unknown, sessionId: unknown, worktree: unknown, fork: unknown) => {
    if (
      typeof cwd !== 'string' ||
      (sessionId !== null && typeof sessionId !== 'string') ||
      (worktree !== null && typeof worktree !== 'string') ||
      typeof fork !== 'boolean'
    ) {
      return t('main.invalidRequest');
    }
    try {
      await launchSession(cwd, sessionId, worktree, fork);
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
  ipcMain.handle('stats:export', async () => {
    await usage.scan();
    const result = await dialog.showSaveDialog(win, {
      title: t('main.exportDialog.title'),
      defaultPath: join(app.getPath('documents'), 'agenttiles-usage.csv'),
      filters: [{ name: t('main.exportDialog.csv'), extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return null;
    writeFileSync(result.filePath, usageCsv(usage.allDays()));
    return result.filePath;
  });
  ipcMain.handle('window:toggleFullscreen', () => win.setFullScreen(!win.isFullScreen()));
  ipcMain.handle('window:isFullscreen', () => win.isFullScreen());
  win.on('enter-full-screen', () => win.webContents.send('fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen', false));
  /** The waiting count outside the window: taskbar overlay (Windows), Dock badge (macOS), launcher count (Linux). */
  function showWaitingCount(badgePng: string | null, count: number): void {
    if (process.platform === 'win32') {
      const badge = typeof badgePng === 'string' ? nativeImage.createFromDataURL(badgePng) : null;
      if (!win.isDestroyed()) win.setOverlayIcon(badge && !badge.isEmpty() ? badge : null, t('main.waitingBadge', { count }));
    } else if (process.platform === 'darwin') {
      app.dock?.setBadge(count > 0 ? String(count) : '');
    } else {
      app.setBadgeCount(count);
    }
  }

  ipcMain.handle('icons:size', () => Math.round(16 * screen.getPrimaryDisplay().scaleFactor));
  ipcMain.on('status:icons', (_e, trayPng: unknown, tooltip: unknown, badgePng: string | null, waiting: number) => {
    if (typeof trayPng !== 'string' || typeof tooltip !== 'string') return;
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

  powerMonitor.on('suspend', () => store.suspended(Date.now()));
  powerMonitor.on('resume', () => store.resumed(Date.now()));

  app.on('second-instance', showWindow);
  // macOS: a click on the Dock icon brings the window back.
  app.on('activate', showWindow);
  app.on('before-quit', () => {
    quitting = true;
    globalShortcut.unregisterAll();
    tray.destroy();
    server.stop();
    // Last: these write the stats files and may throw.
    usage.flush();
    store.stop();
  });
  app.on('window-all-closed', () => {
    // Keep running in the tray.
  });

  applySettings(null);
  integration.repair(settings().permissionTimeoutSec);

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
  const updateView = (): UpdateView => {
    const view = updater.view();
    return { ...view, dismissed: view.available !== null && view.available === config.config.updateDismissed };
  };
  const sendUpdate = (): void => {
    if (!win.isDestroyed()) win.webContents.send('update', updateView());
  };
  const updateChecked = (): void => {
    const view = updateView();
    sendUpdate();
    tray.setUpdate(view.available);
    const version = view.available;
    if (!version || !shouldAnnounce(version, config.config.updateAnnounced)) return;
    // Remembered only once a toast was shown: with toasts off, turning them on announces the version later.
    const shown = notifier.update(version, () => {
      showWindow();
      void runUpdate();
    });
    if (!shown) return;
    config.config.updateAnnounced = version;
    config.save();
  };
  const checkUpdate = (): Promise<void> => updater.check().then(updateChecked);
  const openReleaseNotes = (version: string): Promise<void> => shell.openExternal(releaseUrl(version));

  /** The update dialog of the header button, the tray item and the update toast. */
  async function runUpdate(): Promise<void> {
    const view = updater.view();
    if (view.available && view.canInstall && !view.failed) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'info',
        title: t('main.updateDialog.title'),
        message: t('main.updateDialog.confirm', { version: view.available }),
        detail: t('main.updateDialog.confirmDetail', { command: view.command }),
        buttons: [t('main.updateDialog.updateAndRestart'), t('main.updateDialog.whatsNew'), t('main.updateDialog.later')],
        defaultId: 0,
        cancelId: 2,
      });
      if (response === 1) await openReleaseNotes(view.available);
      if (response !== 0) return;
      try {
        await updater.install(view.available);
      } catch (error) {
        dialog.showErrorBox(t('main.updateDialog.notStarted'), (error as Error).message);
        return;
      }
      quitting = true;
      app.quit();
      return;
    }
    const { response } = await dialog.showMessageBox(win, {
      type: view.failed ? 'warning' : 'info',
      title: t('main.updateDialog.title'),
      message: view.failed
        ? t('main.updateDialog.failed')
        : t('main.updateDialog.available', { version: view.available ?? '' }),
      detail: view.failed
        ? t('main.updateDialog.failedDetail', { output: view.failed, command: view.command })
        : t('main.updateDialog.manualDetail', { command: view.command }),
      buttons: [
        t('main.updateDialog.copyCommand'),
        ...(view.available ? [t('main.updateDialog.whatsNew')] : []),
        t('main.updateDialog.close'),
      ],
      defaultId: 0,
      cancelId: view.available ? 2 : 1,
    });
    if (response === 0) clipboard.writeText(view.command);
    else if (response === 1 && view.available) await openReleaseNotes(view.available);
  }
  ipcMain.handle('update:get', () => updateView());
  ipcMain.handle('update:run', () => runUpdate());
  ipcMain.handle('update:notes', async () => {
    const version = updater.view().available;
    if (version) await openReleaseNotes(version);
  });
  ipcMain.handle('update:dismiss', () => {
    config.config.updateDismissed = updater.view().available;
    config.save();
    sendUpdate();
  });

  // Every renderer handler is registered above: the window is already loading and calls them on mount.
  try {
    await server.start();
  } catch (error) {
    log.error(`ipc server could not listen on ${server.path}`, error);
  }
  store.start();
  setTimeout(() => store.pruneConfig(), 10_000);
  setInterval(() => store.pruneConfig(), PRUNE_INTERVAL_MS);
  void checkUpdate();
  setInterval(() => void checkUpdate(), UPDATE_CHECK_INTERVAL_MS);
  void probe();
  setInterval(() => void probe(), LIMIT_PROBE_INTERVAL_MS);
}
