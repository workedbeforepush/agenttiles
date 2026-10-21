// Type of the API the preload script exposes to the renderer as window.ccdash. Type-only module.
import type {
  DecisionRequest,
  DoctorReport,
  LaunchView,
  SettingsPatch,
  SettingsView,
  Snapshot,
  StatsView,
  TileAction,
} from '../core/types';

export interface CcdashApi {
  getSnapshot(): Promise<Snapshot>;
  onSnapshot(listener: (snapshot: Snapshot) => void): void;
  onOpenSettings(listener: () => void): void;
  onSettingsChanged(listener: () => void): void;
  getSettings(): Promise<SettingsView>;
  updateSettings(patch: SettingsPatch): Promise<SettingsView>;
  setHooks(enabled: boolean): Promise<SettingsView>;
  setStatusline(enabled: boolean): Promise<SettingsView>;
  finishFirstRun(): Promise<SettingsView>;
  unhideSession(sessionId: string): Promise<SettingsView>;
  unhideProject(path: string): Promise<SettingsView>;
  tileAction(sessionId: string, action: TileAction): Promise<void>;
  renameTile(sessionId: string, name: string | null): Promise<void>;
  /** Resolves false when the request is gone (answered in the terminal, timed out). */
  decidePermission(id: string, request: DecisionRequest): Promise<boolean>;
  /** Answers an AskUserQuestion request: question text -> label(s) or free text. Resolves false when rejected. */
  answerQuestion(id: string, answers: Record<string, string>): Promise<boolean>;
  /**
   * Device pixels of a tray / taskbar overlay icon on the primary display. Electron hands Windows only the 1x
   * image, so icons are painted at exactly this size instead of being scaled up by the shell.
   */
  iconPixelSize(): Promise<number>;
  /** Tray icon and tooltip, and the taskbar overlay badge (null removes it). */
  setStatusIcons(trayPng: string, tooltip: string, taskbarBadgePng: string | null, badgeText: string): void;
  setOrder(sessionIds: string[]): Promise<void>;
  toggleFullscreen(): Promise<void>;
  isFullscreen(): Promise<boolean>;
  onFullscreen(listener: (fullscreen: boolean) => void): void;
  /** States sessions just changed to (for sound cues); first sightings are not included. */
  onTransitions(listener: (states: string[]) => void): void;
  /** Queries the plan limits now; resolves false when the query failed. */
  refreshLimits(): Promise<boolean>;
  runDoctor(): Promise<DoctorReport>;
  /** Recent project folders and ended sessions, for starting or resuming a session. */
  recentSessions(): Promise<LaunchView>;
  /** Opens `claude` (or `claude --resume <id>`) in a new terminal tab; resolves an error message or null. */
  launchSession(cwd: string, sessionId: string | null): Promise<string | null>;
  /** Folder picker; null when cancelled. */
  pickFolder(): Promise<string | null>;
  /** Statistics of the last 7 or 30 days. */
  getStats(days: 7 | 30): Promise<StatsView>;
}
