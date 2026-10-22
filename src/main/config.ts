// AgentTiles configuration persisted as config.toml in Electron's userData directory.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'smol-toml';
import type {
  KeyAction,
  KeyBinding,
  LogLevel,
  Settings,
  SoundState,
  TerminalTarget,
  ThemeSetting,
  TileSize,
  ViewMode,
} from '../core/types';
import { isLocale } from '../core/i18n';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface Config {
  settings: Settings;
  /** "Don't ask again" in the hook prompt: AgentTiles no longer offers the hooks at start. */
  hookPromptOff: boolean;
  /** The welcome tour ran (finished or skipped); Settings can replay it. */
  tourDone: boolean;
  pins: string[];
  /** Manual tile order (drag and drop), session ids. */
  order: string[];
  hiddenProjects: string[];
  renames: Record<string, string>;
  window: WindowBounds | null;
}

export const DEFAULT_SETTINGS: Settings = {
  alwaysOnTop: false,
  permissionTimeoutSec: 600,
  toasts: true,
  sounds: { needsApproval: true, needsInput: true, done: true, error: true, limitHit: true, contextFull: true },
  soundVolume: 80,
  reminderMin: 5,
  contextWarnPct: 80,
  keys: {
    selectTile: { enabled: true, key: '1-9' },
    jump: { enabled: true, key: 'Enter' },
    deny: { enabled: true, key: 'D' },
    escape: { enabled: true, key: 'Escape' },
    fullscreen: { enabled: true, key: 'F11' },
    nextPage: { enabled: true, key: 'PageDown' },
    prevPage: { enabled: true, key: 'PageUp' },
  },
  autostart: false,
  hotkeyEnabled: false,
  hotkey: 'Control+Alt+C',
  theme: 'system',
  logLevel: 'info',
  viewMode: 'tiles',
  reduceMotion: false,
  tileSize: 'M',
  groupByProject: false,
  language: 'system',
  terminalTarget: 'tab',
};

const THEMES: ThemeSetting[] = ['system', 'dark', 'light'];
const LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug'];
const VIEW_MODES: ViewMode[] = ['tiles', 'list'];
const TILE_SIZES: TileSize[] = ['S', 'M', 'L'];
const TERMINAL_TARGETS: TerminalTarget[] = ['tab', 'window'];

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

const SOUND_STATES: SoundState[] = ['needsApproval', 'needsInput', 'done', 'error', 'limitHit', 'contextFull'];

function sounds(value: unknown, fallback: Record<SoundState, boolean>): Record<SoundState, boolean> {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(SOUND_STATES.map((s) => [s, bool(raw[s], fallback[s])])) as Record<SoundState, boolean>;
}

const KEY_ACTIONS: KeyAction[] = ['selectTile', 'jump', 'deny', 'escape', 'fullscreen', 'nextPage', 'prevPage'];

function keys(value: unknown, fallback: Record<KeyAction, KeyBinding>): Record<KeyAction, KeyBinding> {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(
    KEY_ACTIONS.map((action) => {
      const b = raw[action] && typeof raw[action] === 'object' ? (raw[action] as Record<string, unknown>) : {};
      const key = typeof b['key'] === 'string' && b['key'].length > 0 && b['key'].length <= 40 ? b['key'] : fallback[action].key;
      return [action, { enabled: bool(b['enabled'], fallback[action].enabled), key: action === 'selectTile' ? '1-9' : key }];
    }),
  ) as Record<KeyAction, KeyBinding>;
}

function int(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Normalises user-edited or partial settings; invalid values fall back to defaults field by field. */
export function normaliseSettings(raw: Record<string, unknown>): Settings {
  const d = DEFAULT_SETTINGS;
  const timeout = raw['permissionTimeoutSec'];
  return {
    alwaysOnTop: bool(raw['alwaysOnTop'], d.alwaysOnTop),
    permissionTimeoutSec:
      typeof timeout === 'number' && Number.isInteger(timeout) && timeout >= 10 && timeout <= 3600
        ? timeout
        : d.permissionTimeoutSec,
    toasts: bool(raw['toasts'], d.toasts),
    sounds: sounds(raw['sounds'], d.sounds),
    soundVolume:
      typeof raw['soundVolume'] === 'number' && raw['soundVolume'] >= 0 && raw['soundVolume'] <= 100
        ? Math.round(raw['soundVolume'])
        : d.soundVolume,
    reminderMin: int(raw['reminderMin'], 0, 120, d.reminderMin),
    contextWarnPct: int(raw['contextWarnPct'], 0, 99, d.contextWarnPct),
    keys: keys(raw['keys'], d.keys),
    autostart: bool(raw['autostart'], d.autostart),
    hotkeyEnabled: bool(raw['hotkeyEnabled'], d.hotkeyEnabled),
    hotkey: typeof raw['hotkey'] === 'string' && raw['hotkey'].length > 0 ? raw['hotkey'] : d.hotkey,
    theme: THEMES.includes(raw['theme'] as ThemeSetting) ? (raw['theme'] as ThemeSetting) : d.theme,
    logLevel: LEVELS.includes(raw['logLevel'] as LogLevel) ? (raw['logLevel'] as LogLevel) : d.logLevel,
    viewMode: VIEW_MODES.includes(raw['viewMode'] as ViewMode) ? (raw['viewMode'] as ViewMode) : d.viewMode,
    reduceMotion: bool(raw['reduceMotion'], d.reduceMotion),
    tileSize: TILE_SIZES.includes(raw['tileSize'] as TileSize) ? (raw['tileSize'] as TileSize) : d.tileSize,
    groupByProject: bool(raw['groupByProject'], d.groupByProject),
    language: raw['language'] === 'system' || isLocale(raw['language']) ? raw['language'] : d.language,
    terminalTarget: TERMINAL_TARGETS.includes(raw['terminalTarget'] as TerminalTarget)
      ? (raw['terminalTarget'] as TerminalTarget)
      : d.terminalTarget,
  };
}

function windowBounds(raw: unknown): WindowBounds | null {
  if (!raw || typeof raw !== 'object') return null;
  const w = raw as Record<string, unknown>;
  const n = (k: string): number | null => (typeof w[k] === 'number' ? (w[k] as number) : null);
  const x = n('x');
  const y = n('y');
  const width = n('width');
  const height = n('height');
  if (x === null || y === null || width === null || height === null) return null;
  return { x, y, width, height, maximized: w['maximized'] === true };
}

export class ConfigStore {
  readonly path: string;
  config: Config;

  constructor(dir: string) {
    this.path = join(dir, 'config.toml');
    this.config = this.load();
  }

  private load(): Config {
    if (!existsSync(this.path)) {
      return {
        settings: { ...DEFAULT_SETTINGS },
        hookPromptOff: false,
        tourDone: false,
        pins: [],
        order: [],
        hiddenProjects: [],
        renames: {},
        window: null,
      };
    }
    // A config.toml that does not parse is a user error worth surfacing: fail fast.
    const raw = parse(readFileSync(this.path, 'utf8')) as Record<string, unknown>;
    const state = (raw['state'] ?? {}) as Record<string, unknown>;
    const renames = (raw['renames'] ?? {}) as Record<string, unknown>;
    return {
      settings: normaliseSettings((raw['settings'] ?? {}) as Record<string, unknown>),
      hookPromptOff: state['hookPromptOff'] === true,
      tourDone: state['tourDone'] === true,
      pins: stringList(state['pins']),
      order: stringList(state['order']),
      hiddenProjects: stringList(state['hiddenProjects']),
      renames: Object.fromEntries(
        Object.entries(renames).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      ),
      window: windowBounds(raw['window']),
    };
  }

  save(): void {
    const c = this.config;
    const doc: Record<string, unknown> = {
      settings: c.settings,
      state: { hookPromptOff: c.hookPromptOff, tourDone: c.tourDone, pins: c.pins, order: c.order, hiddenProjects: c.hiddenProjects },
      renames: c.renames,
    };
    if (c.window) doc['window'] = c.window;
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, stringify(doc));
    renameSync(tmp, this.path);
  }
}
