import { contextBridge, ipcRenderer } from 'electron';
import type { AgentTilesApi } from './api';

const api: AgentTilesApi = {
  getSnapshot: () => ipcRenderer.invoke('snapshot:get'),
  onSnapshot: (listener) => {
    ipcRenderer.on('snapshot', (_event, snapshot) => listener(snapshot));
  },
  onOpenSettings: (listener) => {
    ipcRenderer.on('open-settings', () => listener());
  },
  onSettingsChanged: (listener) => {
    ipcRenderer.on('settings-changed', () => listener());
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  setHooks: (enabled) => ipcRenderer.invoke('integration:hooks', enabled),
  setStatusline: (enabled) => ipcRenderer.invoke('integration:statusline', enabled),
  closeHookPrompt: (forever) => ipcRenderer.invoke('hookprompt:close', forever),
  finishTour: () => ipcRenderer.invoke('tour:done'),
  unhideSession: (sessionId) => ipcRenderer.invoke('unhide:session', sessionId),
  unhideProject: (path) => ipcRenderer.invoke('unhide:project', path),
  tileAction: (sessionId, action) => ipcRenderer.invoke('tile:action', sessionId, action),
  renameTile: (sessionId, name) => ipcRenderer.invoke('tile:rename', sessionId, name),
  decidePermission: (id, request) => ipcRenderer.invoke('permission:decide', id, request),
  answerQuestion: (id, answers) => ipcRenderer.invoke('permission:answer', id, answers),
  iconPixelSize: () => ipcRenderer.invoke('icons:size'),
  setStatusIcons: (trayPng, tooltip, taskbarBadgePng, waiting) =>
    ipcRenderer.send('status:icons', trayPng, tooltip, taskbarBadgePng, waiting),
  runDoctor: () => ipcRenderer.invoke('doctor:run'),
  getStats: (days) => ipcRenderer.invoke('stats:get', days),
  exportUsage: () => ipcRenderer.invoke('stats:export'),
  getUpdate: () => ipcRenderer.invoke('update:get'),
  onUpdate: (listener) => {
    ipcRenderer.on('update', (_event, update) => listener(update));
  },
  runUpdate: () => ipcRenderer.invoke('update:run'),
  recentSessions: () => ipcRenderer.invoke('sessions:recent'),
  launchSession: (cwd, sessionId) => ipcRenderer.invoke('sessions:launch', cwd, sessionId),
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  setOrder: (sessionIds) => ipcRenderer.invoke('tiles:order', sessionIds),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
  isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
  onTransitions: (listener) => {
    ipcRenderer.on('transitions', (_event, states: string[]) => listener(states));
  },
  refreshLimits: () => ipcRenderer.invoke('limits:refresh'),
  onFullscreen: (listener) => {
    ipcRenderer.on('fullscreen', (_event, fullscreen: boolean) => listener(fullscreen));
  },
};

contextBridge.exposeInMainWorld('agenttiles', api);
