// Today's activity (sessions, prompts, working and waiting time), persisted in userData/today.json and reset at local
// midnight; finished days move to userData/history.json (per project) for the stats view. Cost comes from the
// transcripts instead (usage.ts).
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionState } from '../core/types';
import { log } from './log';

/** Prompts and state time of one project on one day. */
export interface Activity {
  turns: number;
  workingMs: number;
  waitingMs: number;
}

export interface ActivityDay {
  date: string;
  projects: Record<string, Activity>;
}

export interface TodayActivity {
  sessions: number;
  turns: number;
  workingMs: number;
  waitingMs: number;
}

interface DailyFile {
  date: string;
  sessions: string[];
  turns: number;
  workingMs: number;
  waitingMs: number;
  projects: Record<string, Activity>;
}

const SAVE_DEBOUNCE_MS = 1000;
/** Days kept in history.json. */
const HISTORY_DAYS = 60;
const WORKING = new Set<SessionState>(['working', 'compacting']);
const WAITING = new Set<SessionState>(['needsApproval', 'needsInput']);

export function dateOf(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function empty(date: string): DailyFile {
  return { date, sessions: [], turns: 0, workingMs: 0, waitingMs: 0, projects: dict() };
}

function emptyActivity(): Activity {
  return { turns: 0, workingMs: 0, waitingMs: 0 };
}

/**
 * Objects keyed by project folder name have no prototype: a folder named "__proto__" or "constructor" must be an
 * ordinary key, not an inherited property.
 */
export function dict<T>(entries: [string, T][] = []): Record<string, T> {
  const result = Object.create(null) as Record<string, T>;
  for (const [key, value] of entries) result[key] = value;
  return result;
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** Project totals from a file, with every number checked: a hand-edited or damaged file must not produce NaN. */
function projectsFrom(raw: unknown): Record<string, Activity> {
  if (!raw || typeof raw !== 'object') return dict();
  return dict(
    Object.entries(raw as Record<string, unknown>).map(([name, value]) => {
      const p = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
      return [name, { turns: num(p['turns']), workingMs: num(p['workingMs']), waitingMs: num(p['waitingMs']) }];
    }),
  );
}

/** Per-project totals of a day; `ongoing` adds the time of states that have not ended yet. */
function summarise(d: DailyFile, ongoing: Ongoing[], now: number): ActivityDay {
  const projects = dict<Activity>();
  const get = (name: string): Activity => (projects[name] ??= emptyActivity());
  for (const [name, p] of Object.entries(d.projects)) Object.assign(get(name), p);
  for (const o of ongoing) {
    const ms = now - Math.max(o.sinceMs, startOfDay(now));
    if (WORKING.has(o.state)) get(o.project).workingMs += ms;
    else if (WAITING.has(o.state)) get(o.project).waitingMs += ms;
  }
  for (const [name, p] of Object.entries(projects)) {
    if (p.turns === 0 && p.workingMs === 0 && p.waitingMs === 0) delete projects[name];
  }
  return { date: d.date, projects };
}

export interface Ongoing {
  state: SessionState;
  sinceMs: number;
  project: string;
}

export class DailyStats {
  private readonly path: string;
  private readonly historyPath: string;
  private data: DailyFile;
  private history: ActivityDay[];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    dir: string,
    private readonly clock: () => number = Date.now,
  ) {
    this.path = join(dir, 'today.json');
    this.historyPath = join(dir, 'history.json');
    this.data = this.load();
    this.history = this.loadHistory();
    this.rollOver();
  }

  /** today.json is a cache: a damaged file must never stop the app, so it starts over instead. */
  private load(): DailyFile {
    if (!existsSync(this.path)) return empty(dateOf(this.clock()));
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<DailyFile> | null;
      if (raw && typeof raw.date === 'string' && Array.isArray(raw.sessions)) {
        return {
          date: raw.date,
          sessions: raw.sessions,
          turns: Number(raw.turns) || 0,
          workingMs: Number(raw.workingMs) || 0,
          waitingMs: Number(raw.waitingMs) || 0,
          projects: projectsFrom(raw.projects),
        };
      }
    } catch {
      // fall through
    }
    log.warn('today.json was unreadable and has been reset');
    return empty(dateOf(this.clock()));
  }

  private loadHistory(): ActivityDay[] {
    if (!existsSync(this.historyPath)) return [];
    try {
      const raw = JSON.parse(readFileSync(this.historyPath, 'utf8')) as { days?: unknown } | null;
      if (Array.isArray(raw?.days)) {
        return raw.days
          .filter((d): d is ActivityDay => !!d && typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date))
          .map((d) => ({ date: d.date, projects: projectsFrom(d.projects) }));
      }
    } catch {
      // fall through
    }
    log.warn('history.json was unreadable and has been reset');
    return [];
  }

  private writeAtomic(path: string, value: unknown): void {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(value));
    renameSync(tmp, path);
  }

  /** At the first call after midnight: archives the finished day and starts a new one. */
  private rollOver(): void {
    const now = dateOf(this.clock());
    if (this.data.date === now) return;
    const finished = summarise(this.data, [], this.clock());
    this.history = [...this.history.filter((d) => d.date !== finished.date), finished]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-HISTORY_DAYS);
    try {
      this.writeAtomic(this.historyPath, { days: this.history });
    } catch (error) {
      log.warn(`history.json could not be written: ${(error as Error).message}`);
    }
    this.data = empty(now);
    this.save();
  }

  private save(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.writeAtomic(this.path, this.data);
      } catch (error) {
        log.warn(`today.json could not be written: ${(error as Error).message}`);
      }
    }, SAVE_DEBOUNCE_MS);
  }

  flush(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.writeAtomic(this.path, this.data);
  }

  private project(name: string): Activity {
    return (this.data.projects[name] ??= emptyActivity());
  }

  sawSession(sessionId: string): void {
    this.rollOver();
    if (this.data.sessions.includes(sessionId)) return;
    this.data.sessions.push(sessionId);
    this.save();
  }

  turn(project: string): void {
    this.rollOver();
    this.data.turns++;
    this.project(project).turns++;
    this.save();
  }

  /**
   * Adds the time a session spent in a state that just ended; only working and waiting states are counted. The part
   * before midnight goes to yesterday's archived day.
   */
  addStateTime(state: SessionState, durationMs: number, project: string): void {
    this.rollOver();
    const key = WORKING.has(state) ? 'workingMs' : WAITING.has(state) ? 'waitingMs' : null;
    if (key === null) return;
    const now = this.clock();
    const today = Math.min(durationMs, now - startOfDay(now));
    this.data[key] += today;
    this.project(project)[key] += today;
    this.save();
    const before = Math.min(durationMs - today, 24 * 3_600_000);
    if (before > 0) this.addToYesterday(key, before, project);
  }

  private addToYesterday(key: 'workingMs' | 'waitingMs', ms: number, project: string): void {
    const date = dateOf(startOfDay(this.clock()) - 1);
    let day = this.history.find((d) => d.date === date);
    if (!day) {
      day = { date, projects: dict() };
      this.history = [...this.history, day].sort((a, b) => a.date.localeCompare(b.date)).slice(-HISTORY_DAYS);
    }
    const p = (day.projects[project] ??= emptyActivity());
    p[key] += ms;
    try {
      this.writeAtomic(this.historyPath, { days: this.history });
    } catch (error) {
      log.warn(`history.json could not be written: ${(error as Error).message}`);
    }
  }

  /** Today's totals plus the time of states that are still running (not yet ended by a transition). */
  view(ongoing: Ongoing[] = []): TodayActivity {
    this.rollOver();
    const d = this.data;
    const now = this.clock();
    const running = (states: Set<SessionState>): number =>
      ongoing.filter((o) => states.has(o.state)).reduce((sum, o) => sum + now - Math.max(o.sinceMs, startOfDay(now)), 0);
    return {
      sessions: d.sessions.length,
      turns: d.turns,
      workingMs: d.workingMs + running(WORKING),
      waitingMs: d.waitingMs + running(WAITING),
    };
  }

  /** The last `days` days, oldest first, one entry per calendar day (empty days included); today is live. */
  days(days: number, ongoing: Ongoing[] = []): ActivityDay[] {
    this.rollOver();
    const now = this.clock();
    const byDate = new Map(this.history.map((d) => [d.date, d]));
    byDate.set(this.data.date, summarise(this.data, ongoing, now));
    const result: ActivityDay[] = [];
    const cursor = new Date(startOfDay(now));
    cursor.setDate(cursor.getDate() - (days - 1));
    for (let i = 0; i < days; i++) {
      const date = dateOf(cursor.getTime());
      result.push(byDate.get(date) ?? { date, projects: {} });
      cursor.setDate(cursor.getDate() + 1);
    }
    return result;
  }

  /** First day with recorded activity (YYYY-MM-DD). */
  firstDate(): string {
    return this.history[0]?.date ?? this.data.date;
  }
}
