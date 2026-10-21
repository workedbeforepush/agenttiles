// Today's statistics, persisted in userData/today.json and reset at local midnight; finished days move to
// userData/history.json (per project) for the stats view.
// Statusline cost is cumulative per session, so each session keeps a baseline: 0 for sessions started today,
// otherwise the total at the first sighting or at midnight.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DaySummary, ProjectDay, SessionState, StatsView, TodayView } from '../core/types';
import { log } from './log';

interface CostEntry {
  baseline: number;
  latest: number;
  project: string;
}

interface DailyFile {
  date: string;
  costs: Record<string, CostEntry>;
  sessions: string[];
  turns: number;
  workingMs: number;
  waitingMs: number;
  /** Prompts and state time per project; cost per project comes from `costs`. */
  projects: Record<string, Omit<ProjectDay, 'costUsd'>>;
}

const SAVE_DEBOUNCE_MS = 1000;
/** Days kept in history.json. */
const HISTORY_DAYS = 60;
const WORKING = new Set<SessionState>(['working', 'compacting']);
const WAITING = new Set<SessionState>(['needsApproval', 'needsInput']);

function dateOf(ms: number): string {
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
  return { date, costs: {}, sessions: [], turns: 0, workingMs: 0, waitingMs: 0, projects: dict() };
}

function emptyProject(): Omit<ProjectDay, 'costUsd'> {
  return { turns: 0, workingMs: 0, waitingMs: 0 };
}

/**
 * Objects keyed by project folder name have no prototype: a folder named "__proto__" or "constructor" must be an
 * ordinary key, not an inherited property.
 */
function dict<T>(entries: [string, T][] = []): Record<string, T> {
  const result = Object.create(null) as Record<string, T>;
  for (const [key, value] of entries) result[key] = value;
  return result;
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** Project totals from a file, with every number checked: a hand-edited or damaged file must not produce NaN. */
function projectsFrom<T extends Partial<ProjectDay>>(raw: unknown, withCost: boolean): Record<string, T> {
  if (!raw || typeof raw !== 'object') return dict();
  return dict(
    Object.entries(raw as Record<string, unknown>).map(([name, value]) => {
      const p = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
      const day = { turns: num(p['turns']), workingMs: num(p['workingMs']), waitingMs: num(p['waitingMs']) };
      return [name, (withCost ? { costUsd: num(p['costUsd']), ...day } : day) as unknown as T];
    }),
  );
}

/** Per-project totals of a day; `ongoing` adds the time of states that have not ended yet. */
function summarise(d: DailyFile, ongoing: Ongoing[], now: number): DaySummary {
  const projects = dict<ProjectDay>();
  const get = (name: string): ProjectDay => (projects[name] ??= { costUsd: 0, ...emptyProject() });
  for (const [name, p] of Object.entries(d.projects)) Object.assign(get(name), p);
  for (const entry of Object.values(d.costs)) get(entry.project).costUsd += Math.max(0, entry.latest - entry.baseline);
  for (const o of ongoing) {
    const ms = now - Math.max(o.sinceMs, startOfDay(now));
    if (WORKING.has(o.state)) get(o.project).workingMs += ms;
    else if (WAITING.has(o.state)) get(o.project).waitingMs += ms;
  }
  for (const [name, p] of Object.entries(projects)) {
    if (p.costUsd === 0 && p.turns === 0 && p.workingMs === 0 && p.waitingMs === 0) delete projects[name];
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
  private history: DaySummary[];
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
      if (raw && typeof raw.date === 'string' && raw.costs && Array.isArray(raw.sessions)) {
        const costs: Record<string, CostEntry> = {};
        for (const [id, e] of Object.entries(raw.costs)) costs[id] = { ...e, project: e.project ?? 'unknown' };
        return {
          date: raw.date,
          costs,
          sessions: raw.sessions,
          turns: Number(raw.turns) || 0,
          workingMs: Number(raw.workingMs) || 0,
          waitingMs: Number(raw.waitingMs) || 0,
          projects: projectsFrom(raw.projects, false),
        };
      }
    } catch {
      // fall through
    }
    log.warn('today.json was unreadable and has been reset');
    return empty(dateOf(this.clock()));
  }

  private loadHistory(): DaySummary[] {
    if (!existsSync(this.historyPath)) return [];
    try {
      const raw = JSON.parse(readFileSync(this.historyPath, 'utf8')) as { days?: unknown } | null;
      if (Array.isArray(raw?.days)) {
        return raw.days
          .filter((d): d is DaySummary => !!d && typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date))
          .map((d) => ({ date: d.date, projects: projectsFrom<ProjectDay>(d.projects, true) }));
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

  /** Forgets carried cost baselines of sessions that no longer run. */
  retain(liveSessionIds: Set<string>): void {
    const before = Object.keys(this.data.costs).length;
    for (const id of Object.keys(this.data.costs)) {
      const entry = this.data.costs[id];
      // Keep sessions that ran today (they count towards today's cost) and live ones.
      if (!liveSessionIds.has(id) && entry && entry.latest === entry.baseline) delete this.data.costs[id];
    }
    if (Object.keys(this.data.costs).length !== before) this.save();
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
    const costs: Record<string, CostEntry> = {};
    for (const [id, entry] of Object.entries(this.data.costs)) {
      costs[id] = { baseline: entry.latest, latest: entry.latest, project: entry.project };
    }
    this.data = { ...empty(now), costs };
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

  private project(name: string): Omit<ProjectDay, 'costUsd'> {
    return (this.data.projects[name] ??= emptyProject());
  }

  recordCost(sessionId: string, totalUsd: number, sessionStartedAt: number, project: string): void {
    this.rollOver();
    const existing = this.data.costs[sessionId];
    if (existing) {
      existing.latest = totalUsd;
      existing.project = project;
    } else {
      const baseline = sessionStartedAt >= startOfDay(this.clock()) ? 0 : totalUsd;
      this.data.costs[sessionId] = { baseline, latest: totalUsd, project };
    }
    this.save();
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
    const p = (day.projects[project] ??= { costUsd: 0, ...emptyProject() });
    p[key] += ms;
    try {
      this.writeAtomic(this.historyPath, { days: this.history });
    } catch (error) {
      log.warn(`history.json could not be written: ${(error as Error).message}`);
    }
  }

  /** Today's totals plus the time of states that are still running (not yet ended by a transition). */
  view(ongoing: Ongoing[] = []): TodayView {
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
      costUsd: Object.values(d.costs).reduce((sum, e) => sum + Math.max(0, e.latest - e.baseline), 0),
    };
  }

  /** The last `days` days, oldest first, one entry per calendar day (empty days included); today is live. */
  stats(days: number, ongoing: Ongoing[] = []): StatsView {
    this.rollOver();
    const now = this.clock();
    const byDate = new Map(this.history.map((d) => [d.date, d]));
    byDate.set(this.data.date, summarise(this.data, ongoing, now));
    const result: DaySummary[] = [];
    const cursor = new Date(startOfDay(now));
    cursor.setDate(cursor.getDate() - (days - 1));
    for (let i = 0; i < days; i++) {
      const date = dateOf(cursor.getTime());
      result.push(byDate.get(date) ?? { date, projects: {} });
      cursor.setDate(cursor.getDate() + 1);
    }
    const first = this.history[0]?.date ?? this.data.date;
    return { days: result, recordedSince: first };
  }
}
