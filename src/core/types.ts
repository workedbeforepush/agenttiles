// Types shared by main process, hook script and renderer. Type-only module: no runtime code.
import type { LanguageSetting, Locale } from './i18n';

export type SessionState =
  | 'working'
  | 'needsApproval'
  | 'needsInput'
  | 'done'
  | 'idle'
  | 'error'
  | 'limitHit'
  | 'compacting'
  | 'shell'
  | 'unknown';

export interface QuestionView {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
}

export interface DiffLine {
  /** "skip" stands for unchanged lines left out (its text says how many) or separates edits. */
  kind: 'add' | 'del' | 'ctx' | 'skip';
  text: string;
}

export interface DiffView {
  path: string;
  lines: DiffLine[];
  truncated: boolean;
  added: number;
  removed: number;
  /** "new file", "every occurrence" or null. */
  note: string | null;
}

export interface PendingPermission {
  id: string;
  toolName: string;
  summary: string;
  toolInput: unknown;
  /** Set for AskUserQuestion: the questions to answer on the tile instead of Allow / Deny. */
  questions: QuestionView[] | null;
  /** Set for Edit, MultiEdit and Write: the change the tool would make. */
  diff: DiffView | null;
  /** Set for ExitPlanMode: the plan as Markdown, for reading (Claude Code takes the decision only in its own dialog). */
  plan: string | null;
  /** What "Always allow" does (Claude Code's own suggestion); null when it offers none. */
  alwaysLabel: string | null;
}

/** A decision on a held permission request, from a tile or a review dialog. */
export interface DecisionRequest {
  decision: 'allow' | 'deny';
  /** Allow and apply Claude Code's suggested permission rules ("always allow"). */
  always?: boolean;
  /** For deny: what Claude is told, e.g. feedback on a plan. */
  message?: string;
}

export interface HistoryPoint {
  state: SessionState;
  at: number;
}

export interface TaskView {
  subject: string;
  done: boolean;
}

export interface PullRequestView {
  number: number;
  url: string | null;
  reviewState: string | null;
}

export interface GitView {
  branch: string | null;
  worktree: string | null;
  pr: PullRequestView | null;
  linesAdded: number | null;
  linesRemoved: number | null;
}

/** The word shown for a state; questions and plans have a more specific one. Translated by the UI. */
export type StateLabel = SessionState | 'question' | 'planReady';

/**
 * The activity line: text from the session (tool call, question) shown as it is, or a fixed phrase the UI translates.
 * `failed` wraps the tool call that failed.
 */
export type Activity =
  | { kind: 'text'; text: string }
  | { kind: 'failed'; text: string }
  | { kind: 'thinking' }
  | { kind: 'planReady' };

export interface TileView {
  sessionId: string;
  pid: number;
  cwd: string;
  project: string;
  name: string;
  state: SessionState;
  label: StateLabel;
  stateSince: number;
  activity: Activity | null;
  model: string | null;
  subagents: number;
  tasksDone: number;
  tasksTotal: number;
  costUsd: number | null;
  contextPct: number | null;
  hooks: boolean;
  pinned: boolean;
  startedAt: number;
  lastPrompt: string | null;
  lastAssistant: string | null;
  pending: PendingPermission | null;
  version: string | null;
  /** Background sessions (`claude --bg`) only: the id for `claude attach` / `claude stop`. */
  jobId: string | null;
  /** Most recent tool calls, newest last (at most 3). */
  recentTools: string[];
  /** Start of the running turn, null when no turn is running. */
  turnStartedAt: number | null;
  /** Duration of the last finished turn. */
  lastTurnMs: number | null;
  /** State changes of the last 30 minutes, oldest first; the last entry is the current state. */
  history: HistoryPoint[];
  git: GitView;
  tasks: TaskView[];
  subagentTypes: string[];
}

export interface RateLimit {
  usedPct: number;
  resetsAt: number | null;
  /** Epoch ms of the statusline update that reported this value; AgentTiles learns limits only from statusline runs. */
  observedAt: number;
}

export interface TodayView {
  sessions: number;
  turns: number;
  workingMs: number;
  waitingMs: number;
  costUsd: number;
}

export interface ProjectDay {
  costUsd: number;
  turns: number;
  workingMs: number;
  waitingMs: number;
}

/** One calendar day (local time), per project folder name. */
export interface DaySummary {
  date: string;
  projects: Record<string, ProjectDay>;
}

/** Tokens and API-equivalent cost of one model; `costUsd` is null for a model without a known price. */
export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUsd: number | null;
}

export interface StatsView {
  /** Oldest first, one entry per day including empty ones; the last entry is today, live. */
  days: DaySummary[];
  /** Usage per model over the whole range. */
  models: Record<string, ModelUsage>;
  /** First day with data (YYYY-MM-DD): the oldest transcript or the first day AgentTiles ran. */
  recordedSince: string;
}

export interface HeaderView {
  working: number;
  waiting: number;
  done: number;
  fiveHour: RateLimit | null;
  sevenDay: RateLimit | null;
  /** When the 5 h limit is reached at the current pace (epoch ms); null when not before the reset. */
  fiveHourEta: number | null;
  today: TodayView;
}

export interface Snapshot {
  tiles: TileView[];
  header: HeaderView;
}

export interface RecentSession {
  sessionId: string;
  cwd: string;
  project: string;
  title: string;
  /** Last write to the transcript (epoch ms). */
  lastAt: number;
}

export interface RecentProject {
  cwd: string;
  project: string;
  lastAt: number;
}

/** What the "new session" dialog offers: recent project folders and ended sessions to resume. */
export interface LaunchView {
  projects: RecentProject[];
  sessions: RecentSession[];
}

export type ThemeSetting = 'system' | 'dark' | 'light';
export type TerminalTarget = 'tab' | 'window';
export type ViewMode = 'tiles' | 'list';
export type TileSize = 'S' | 'M' | 'L';
/** In-app keyboard shortcuts (the question dialog keeps its own fixed keys). */
export type KeyAction = 'selectTile' | 'jump' | 'deny' | 'escape' | 'fullscreen' | 'nextPage' | 'prevPage';

export interface KeyBinding {
  enabled: boolean;
  /** Combo like "D", "F11", "Ctrl+Shift+J"; ignored for selectTile, which always uses 1–9. */
  key: string;
}

/** States that can play a sound cue. */
export type SoundState = 'needsApproval' | 'needsInput' | 'done' | 'error' | 'limitHit' | 'contextFull';
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface Settings {
  alwaysOnTop: boolean;
  permissionTimeoutSec: number;
  toasts: boolean;
  /** Sound cue per state, played by AgentTiles itself (toasts stay silent). */
  sounds: Record<SoundState, boolean>;
  /** Volume of the sound cues, 0..100. */
  soundVolume: number;
  /** Remind again (toast and sound) every this many minutes while a session waits for the user; 0 = off. */
  reminderMin: number;
  /** Warn once when a session's context window reaches this percentage; 0 = off. */
  contextWarnPct: number;
  keys: Record<KeyAction, KeyBinding>;
  autostart: boolean;
  hotkeyEnabled: boolean;
  hotkey: string;
  theme: ThemeSetting;
  logLevel: LogLevel;
  viewMode: ViewMode;
  reduceMotion: boolean;
  tileSize: TileSize;
  /** Tiles in one block per project folder, each with a heading. */
  groupByProject: boolean;
  /** UI language: the system's (when AgentTiles ships it) or a fixed one. */
  language: LanguageSetting;
  /** Where new and attached sessions open: a tab in the current terminal window, or a new window. */
  terminalTarget: TerminalTarget;
}

/** A settings change; nested keys and sounds are merged per entry, so two quick edits cannot undo each other. */
export type SettingsPatch = Partial<Omit<Settings, 'keys' | 'sounds'>> & {
  keys?: Partial<Record<KeyAction, KeyBinding>>;
  sounds?: Partial<Record<SoundState, boolean>>;
};

export interface HiddenProject {
  path: string;
}

export interface HiddenSession {
  sessionId: string;
  name: string;
}

export interface IntegrationStatus {
  hooksInstalled: boolean;
  statuslineInstalled: boolean;
  nodePath: string | null;
  error: string | null;
}

/** A newer AgentTiles on npm, and how to get it. */
export interface UpdateView {
  current: string;
  /** The newer version, or null when this is the latest one. */
  available: string | null;
  /** The command that updates, for installs AgentTiles cannot update itself. */
  command: string;
  /** True for a global npm install: AgentTiles runs the update itself. */
  canInstall: boolean;
  /** The end of npm's output when the last update from the app failed. */
  failed: string | null;
}

export interface SettingsView {
  /** AgentTiles' own version. */
  version: string;
  settings: Settings;
  hiddenProjects: string[];
  hiddenSessions: HiddenSession[];
  integration: IntegrationStatus;
  /**
   * Offer the hooks at start: they are not installed, the prompt was neither closed in this run nor turned off, and the
   * tour (which offers them itself) has run.
   */
  askHooks: boolean;
  /** First start: the welcome tour has not run yet. */
  showTour: boolean;
  /** The language the UI uses, resolved from the setting. */
  locale: Locale;
  platform: string;
}

export interface DoctorRow {
  pid: number;
  sessionId: string;
  name: string;
  registryStatus: string;
  alive: boolean;
  agentsStatus: string | null;
  shown: boolean;
}

export interface DoctorReport {
  rows: DoctorRow[];
  /** claude processes without a registry entry (print mode, background workers, crashed registry); null if unsupported. */
  unregisteredPids: number[] | null;
  agentsError: string | null;
  ipcListening: boolean;
  ipcPath: string;
  integration: IntegrationStatus;
  claudeVersion: string | null;
}

export type TileAction =
  | 'pin'
  | 'unpin'
  | 'hideSession'
  | 'hideProject'
  | 'openFolder'
  | 'copySessionId'
  | 'focus'
  | 'stop';
