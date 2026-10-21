// Session store: discovers sessions from the registry, tails transcripts, applies hook events and builds snapshots.
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  watch,
  type FSWatcher,
} from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { DecisionRequest, HeaderView, RateLimit, SessionState, Snapshot, StatsView, TileView } from '../core/types';
import { toolDiff } from '../core/diff';
import { isRegistryFileName, parseRegistryEntry, type RegistryEntry } from '../core/registry';
import { applyTranscriptLine, emptyTranscriptInfo } from '../core/transcript';
import { projectName, sessionsDir, transcriptPath } from '../core/paths';
import {
  addPending,
  applyHookEvent,
  questionAnswerInput,
  applyStatusline,
  newRecord,
  refreshView,
  removePending,
  toTile,
  type SessionRecord,
} from '../core/session';
import type { DecisionExtras, PermissionDecision } from '../core/protocol';
import { addSample, limitEta, type UsageSample } from '../core/forecast';
import { isAlive } from './platform';
import type { ConfigStore } from './config';
import type { DailyStats } from './daily';
import type { LimitsCache } from './limits';
import { log } from './log';
import { readGitBranch } from './git';

const POLL_MS = 2000;
const EMIT_DEBOUNCE_MS = 50;
const TRANSCRIPT_DEBOUNCE_MS = 100;
const HOOK_ONLY_TTL_MS = 60_000;
/** A registered session disappears only after this many scans in a row without a live registry entry. */
const MISSES_BEFORE_REMOVE = 2;
/** On first sight only the end of a transcript is read; transcripts can be hundreds of MB. */
const TRANSCRIPT_START_BYTES = 2 * 1024 * 1024;
/** Upper bound per read; the poll continues where the last read stopped. */
const TRANSCRIPT_READ_BYTES = 4 * 1024 * 1024;
/** Write diffs compare against the current file; bigger files are not read (the request shows its raw input). */
const DIFF_FILE_MAX_BYTES = 2 * 1024 * 1024;
/** Chunk size when searching the skipped start of a transcript for the session title. */
const TITLE_SCAN_BYTES = 1024 * 1024;
const TITLE_SCAN_OVERLAP = 8 * 1024;

interface Tail {
  path: string;
  offset: number;
  partial: string;
  /** The first line after a mid-file start is incomplete and must be dropped. */
  dropFirstLine: boolean;
  watcher: FSWatcher | null;
  timer: NodeJS.Timeout | null;
}

export interface Transition {
  tile: TileView;
  state: SessionState;
}

export interface StoreListener {
  snapshot(snapshot: Snapshot): void;
  transitions(transitions: Transition[]): void;
  configChanged(): void;
}

export class SessionStore {
  private readonly records = new Map<string, SessionRecord>();
  private readonly tails = new Map<string, Tail>();
  private readonly ended = new Set<string>();
  private readonly hiddenSessions = new Map<string, string>();
  private readonly timeouts = new Map<string, NodeJS.Timeout>();
  private readonly shown = new Set<string>();
  /** Last successfully parsed registry entry per file, used while a file is being rewritten. */
  private readonly lastGood = new Map<string, RegistryEntry>();
  private readonly misses = new Map<string, number>();
  /** Processes AgentTiles started itself (limit probes); their registry entries are not sessions of the user. */
  private readonly ownPids = new Set<number>();
  private fiveHour: RateLimit | null = null;
  private sevenDay: RateLimit | null = null;
  private fiveHourSamples: UsageSample[] = [];
  private dirWatcher: FSWatcher | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private emitTimer: NodeJS.Timeout | null = null;
  private scanTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ConfigStore,
    private readonly daily: DailyStats,
    private readonly limitsCache: LimitsCache,
    private readonly reply: (id: string, decision: PermissionDecision, extras?: DecisionExtras) => boolean,
    private readonly listener: StoreListener,
  ) {
    const cached = limitsCache.load();
    this.fiveHour = cached.fiveHour;
    this.sevenDay = cached.sevenDay;
  }

  start(): void {
    this.scanRegistry();
    this.pollTimer = setInterval(() => this.scanRegistry(), POLL_MS);
  }

  stop(): void {
    this.dirWatcher?.close();
    if (this.pollTimer) clearInterval(this.pollTimer);
    for (const tail of this.tails.values()) this.closeTail(tail);
    for (const timer of this.timeouts.values()) clearTimeout(timer);
    this.daily.flush();
  }

  private scheduleScan(): void {
    if (this.scanTimer) return;
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null;
      this.scanRegistry();
    }, EMIT_DEBOUNCE_MS);
  }

  /** (Re)creates the directory watcher; the poll keeps working without it. */
  private ensureDirWatcher(dir: string): void {
    if (this.dirWatcher || !existsSync(dir)) return;
    try {
      const watcher = watch(dir, () => this.scheduleScan());
      watcher.on('error', (error) => {
        log.warn(`sessions watcher: ${error.message}`);
        watcher.close();
        if (this.dirWatcher === watcher) this.dirWatcher = null;
      });
      this.dirWatcher = watcher;
    } catch (error) {
      log.warn(`sessions watcher could not start: ${(error as Error).message}`);
    }
  }

  // ---- registry -------------------------------------------------------------------------------------------

  /** Live interactive entries, or null when the directory itself could not be read (keep the current state). */
  private readRegistry(dir: string): RegistryEntry[] | null {
    if (!existsSync(dir)) return [];
    let names: string[];
    try {
      names = readdirSync(dir).filter(isRegistryFileName);
    } catch (error) {
      log.warn(`sessions directory unreadable: ${(error as Error).message}`);
      return null;
    }
    for (const name of [...this.lastGood.keys()]) if (!names.includes(name)) this.lastGood.delete(name);
    const entries: RegistryEntry[] = [];
    for (const name of names) {
      let entry: RegistryEntry | null = null;
      try {
        entry = parseRegistryEntry(readFileSync(join(dir, name), 'utf8'));
      } catch {
        // Being rewritten or just deleted.
      }
      if (entry) this.lastGood.set(name, entry);
      else entry = this.lastGood.get(name) ?? null;
      if (!entry || entry.kind !== 'interactive' || this.ownPids.has(entry.pid)) continue;
      if (!isAlive(entry.pid, entry.procStart)) continue;
      entries.push(entry);
    }
    return entries;
  }

  private scanRegistry(): void {
    try {
      const dir = sessionsDir();
      this.ensureDirWatcher(dir);
      const now = Date.now();
      const entries = this.readRegistry(dir);
      if (entries === null) return;
      const live = new Set(entries.map((e) => e.sessionId));

      for (const id of [...this.ended]) if (!live.has(id)) this.ended.delete(id);

      for (const entry of entries) {
        if (this.ended.has(entry.sessionId)) continue;
        this.misses.delete(entry.sessionId);
        let rec = this.records.get(entry.sessionId);
        if (!rec) {
          rec = newRecord(entry.sessionId, entry.cwd, now);
          this.records.set(entry.sessionId, rec);
          log.info(`session discovered ${entry.sessionId} pid ${entry.pid} ${entry.cwd}`);
        }
        // The registry holds the session's project folder. A `cd` in the Bash tool (CwdChanged) is not the project.
        rec.cwd = entry.cwd;
        rec.registry = entry;
        if (!rec.transcriptPath) rec.transcriptPath = transcriptPath(entry.cwd, entry.sessionId);
      }

      for (const [id, rec] of [...this.records]) {
        if (live.has(id)) continue;
        if (rec.registry === null) {
          if (now - rec.firstSeen > HOOK_ONLY_TTL_MS) this.remove(id);
          continue;
        }
        const missed = (this.misses.get(id) ?? 0) + 1;
        this.misses.set(id, missed);
        if (missed >= MISSES_BEFORE_REMOVE) this.remove(id);
      }

      for (const rec of this.records.values()) this.tail(rec);
    } catch (error) {
      log.error('registry scan failed', error);
    }
    this.changed();
  }

  private remove(sessionId: string): void {
    const rec = this.records.get(sessionId);
    if (!rec) return;
    for (const pending of rec.pending) this.release(pending.id);
    this.records.delete(sessionId);
    this.hiddenSessions.delete(sessionId);
    this.shown.delete(sessionId);
    this.misses.delete(sessionId);
    const tail = this.tails.get(sessionId);
    if (tail) this.closeTail(tail);
    this.tails.delete(sessionId);
    log.info(`session ended ${sessionId}`);
  }

  // ---- transcripts ----------------------------------------------------------------------------------------

  private closeTail(tail: Tail): void {
    tail.watcher?.close();
    if (tail.timer) clearTimeout(tail.timer);
  }

  private tail(rec: SessionRecord): void {
    // Never (re)attach to a record that was removed in the meantime.
    if (this.records.get(rec.sessionId) !== rec) return;
    const path = rec.transcriptPath;
    if (!path) return;
    try {
      let tail = this.tails.get(rec.sessionId);
      if (tail && tail.path !== path) {
        this.closeTail(tail);
        this.tails.delete(rec.sessionId);
        rec.transcript = emptyTranscriptInfo();
        tail = undefined;
      }
      if (!tail) {
        if (!existsSync(path)) return;
        const size = statSync(path).size;
        const offset = Math.max(0, size - TRANSCRIPT_START_BYTES);
        const created: Tail = { path, offset, partial: '', dropFirstLine: offset > 0, watcher: null, timer: null };
        this.tails.set(rec.sessionId, created);
        // The title is needed for the tile name and the terminal tab; it may sit in the part that was skipped.
        if (offset > 0) void this.backfillTitle(rec, path, offset);
        try {
          const watcher = watch(path, () => this.scheduleTailRead(rec.sessionId));
          watcher.on('error', () => undefined);
          created.watcher = watcher;
        } catch (error) {
          log.debug(`transcript watch failed for ${path}: ${(error as Error).message}`);
        }
      }
      this.readTail(rec);
    } catch (error) {
      log.warn(`transcript ${path}: ${(error as Error).message}`);
    }
  }

  /** Searches the transcript backwards from `end` for the latest ai-title, in the background. */
  private async backfillTitle(rec: SessionRecord, path: string, end: number): Promise<void> {
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(path, 'r');
      for (let pos = end; pos > 0; ) {
        if (rec.transcript.aiTitle || this.records.get(rec.sessionId) !== rec) return;
        const start = Math.max(0, pos - TITLE_SCAN_BYTES);
        const length = Math.min(end, pos + TITLE_SCAN_OVERLAP) - start;
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, start);
        const lines = buffer.toString('utf8').split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i] ?? '';
          if (!line.includes('"ai-title"')) continue;
          try {
            const entry = JSON.parse(line) as { type?: unknown; aiTitle?: unknown };
            if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string') {
              if (!rec.transcript.aiTitle) rec.transcript.aiTitle = entry.aiTitle;
              this.changed();
              return;
            }
          } catch {
            // A line cut at the chunk border; the overlap of the next chunk contains it whole.
          }
        }
        pos = start;
      }
    } catch (error) {
      log.debug(`title scan of ${path} failed: ${(error as Error).message}`);
    } finally {
      await handle?.close();
    }
  }

  private scheduleTailRead(sessionId: string): void {
    const tail = this.tails.get(sessionId);
    if (!tail || tail.timer) return;
    tail.timer = setTimeout(() => {
      tail.timer = null;
      const rec = this.records.get(sessionId);
      if (!rec || this.tails.get(sessionId) !== tail) return;
      try {
        if (this.readTail(rec)) this.changed();
      } catch (error) {
        log.warn(`transcript ${tail.path}: ${(error as Error).message}`);
      }
    }, TRANSCRIPT_DEBOUNCE_MS);
  }

  /** Reads newly appended transcript bytes (bounded per call). Returns true when anything was applied. */
  private readTail(rec: SessionRecord): boolean {
    const tail = this.tails.get(rec.sessionId);
    if (!tail) return false;
    const size = statSync(tail.path).size;
    if (size < tail.offset) {
      tail.offset = Math.max(0, size - TRANSCRIPT_START_BYTES);
      tail.dropFirstLine = tail.offset > 0;
      tail.partial = '';
      rec.transcript = emptyTranscriptInfo();
    }
    if (size === tail.offset) return false;
    const length = Math.min(size - tail.offset, TRANSCRIPT_READ_BYTES);
    const buffer = Buffer.alloc(length);
    const fd = openSync(tail.path, 'r');
    try {
      readSync(fd, buffer, 0, length, tail.offset);
    } finally {
      closeSync(fd);
    }
    tail.offset += length;
    const lines = (tail.partial + buffer.toString('utf8')).split('\n');
    tail.partial = lines.pop() ?? '';
    if (tail.dropFirstLine && lines.length > 0) {
      lines.shift();
      tail.dropFirstLine = false;
    }
    for (const line of lines) if (line.trim()) applyTranscriptLine(rec.transcript, line);
    return true;
  }

  // ---- hook input -----------------------------------------------------------------------------------------

  private recordFor(input: Record<string, unknown>): SessionRecord | null {
    const sessionId = input['session_id'];
    if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 200) return null;
    if (this.ended.has(sessionId)) return null;
    let rec = this.records.get(sessionId);
    if (!rec) {
      const cwd = typeof input['cwd'] === 'string' ? input['cwd'] : '';
      rec = newRecord(sessionId, cwd, Date.now());
      this.records.set(sessionId, rec);
    }
    return rec;
  }

  /** Event time from the hook process; never in the future. */
  private eventTime(ts: number): number {
    return Math.min(ts, Date.now());
  }

  handleEvent(input: Record<string, unknown>, ts: number): void {
    const rec = this.recordFor(input);
    if (!rec) return;
    log.debug(`hook ${String(input['hook_event_name'])} ${rec.sessionId}`);
    const effects = applyHookEvent(rec, input, this.eventTime(ts));
    // Only real (registered) sessions count; print-mode and background runs also fire hooks.
    if (rec.registry !== null) {
      this.daily.sawSession(rec.sessionId);
      if (effects.turnStarted) this.daily.turn(projectName(rec.cwd));
    }
    for (const id of effects.release) this.release(id);
    if (effects.configChanged) this.listener.configChanged();
    if (effects.ended) {
      this.ended.add(rec.sessionId);
      this.remove(rec.sessionId);
    } else {
      this.tail(rec);
    }
    this.changed();
  }

  handleStatusline(payload: Record<string, unknown>): void {
    const rec = this.recordFor(payload);
    if (rec) {
      applyStatusline(rec, payload);
      const cost = rec.statusline?.costUsd;
      if (cost !== null && cost !== undefined && rec.registry !== null) {
        this.daily.recordCost(rec.sessionId, cost, rec.registry.startedAt, projectName(rec.cwd));
      }
    }
    const limits = payload['rate_limits'] as Record<string, Record<string, unknown> | undefined> | undefined;
    const limit = (raw: Record<string, unknown> | undefined): RateLimit | null =>
      typeof raw?.['used_percentage'] === 'number'
        ? {
            usedPct: raw['used_percentage'],
            resetsAt: typeof raw['resets_at'] === 'number' ? raw['resets_at'] : null,
            observedAt: Date.now(),
          }
        : null;
    if (limits && typeof limits === 'object') {
      this.updateLimits({ fiveHour: limit(limits['five_hour']), sevenDay: limit(limits['seven_day']) });
    }
    this.changed();
  }

  /** Marks a process AgentTiles started itself, or forgets it once it ended. */
  ownProcess(pid: number, running: boolean): void {
    if (running) {
      this.ownPids.add(pid);
      return;
    }
    // The registry file can outlive the process briefly; the liveness check covers it after that.
    setTimeout(() => this.ownPids.delete(pid), POLL_MS * 2);
  }

  /** New plan limits from a statusline update or a limit probe; a missing window keeps its last value. */
  updateLimits(next: { fiveHour: RateLimit | null; sevenDay: RateLimit | null }): void {
    this.fiveHour = next.fiveHour ?? this.fiveHour;
    this.sevenDay = next.sevenDay ?? this.sevenDay;
    if (next.fiveHour) {
      this.fiveHourSamples = addSample(this.fiveHourSamples, { at: next.fiveHour.observedAt, usedPct: next.fiveHour.usedPct });
    }
    try {
      this.limitsCache.save({ fiveHour: this.fiveHour, sevenDay: this.sevenDay });
    } catch (error) {
      log.warn(`limits.json could not be written: ${(error as Error).message}`);
    }
    this.changed();
  }

  handlePermission(id: string, input: Record<string, unknown>, ts: number): void {
    const rec = this.recordFor(input);
    // Nobody can answer on a tile that is not shown (print mode, background or hidden sessions): never hold those.
    if (!rec || !this.isVisible(rec)) {
      this.reply(id, 'pass');
      return;
    }
    addPending(rec, id, input, this.eventTime(ts), this.diffOf(input));
    const timeoutMs = this.config.config.settings.permissionTimeoutSec * 1000;
    this.timeouts.set(
      id,
      setTimeout(() => {
        log.info(`permission ${id} timed out`);
        this.resolvePermission(id, 'pass');
      }, timeoutMs),
    );
    this.changed();
  }

  /** The change a file tool call would make; Write is compared with the file as it is now. */
  private diffOf(input: Record<string, unknown>): ReturnType<typeof toolDiff> {
    const toolName = typeof input['tool_name'] === 'string' ? input['tool_name'] : '';
    const toolInput = input['tool_input'];
    if (toolName !== 'Write') return toolDiff(toolName, toolInput, null);
    const path = (toolInput as { file_path?: unknown } | null)?.file_path;
    if (typeof path !== 'string') return null;
    try {
      if (!existsSync(path)) return toolDiff(toolName, toolInput, null);
      // Only plain files: a device or pipe path would block the main thread on read.
      const info = statSync(path);
      if (!info.isFile() || info.size > DIFF_FILE_MAX_BYTES) return null;
      return toolDiff(toolName, toolInput, readFileSync(path, 'utf8'));
    } catch (error) {
      log.debug(`diff of ${path} failed: ${(error as Error).message}`);
      return null;
    }
  }

  /** The hook process went away; Claude Code no longer waits for this decision. */
  permissionGone(id: string): void {
    this.clearTimeout(id);
    for (const rec of this.records.values()) if (removePending(rec, id)) this.changed();
  }

  /** Answers a held permission request from a tile or dialog; false when the request is gone. */
  decide(id: string, request: DecisionRequest): boolean {
    const pending = [...this.records.values()].flatMap((r) => r.pending).find((p) => p.id === id);
    if (!pending) return false;
    const extras: DecisionExtras = {};
    if (request.decision === 'allow') {
      if (request.always && pending.suggestions.length > 0) extras.updatedPermissions = pending.suggestions;
    } else if (request.message?.trim()) {
      extras.message = request.message.trim();
    }
    this.resolvePermission(id, request.decision, extras);
    return true;
  }

  /** Answers a held permission request, or passes it back to Claude Code's dialog on timeout. */
  resolvePermission(id: string, decision: PermissionDecision, extras?: DecisionExtras): void {
    this.release(id, decision, extras);
    for (const rec of this.records.values()) removePending(rec, id);
    this.changed();
  }

  /**
   * Answers a held AskUserQuestion request: allow with the original input plus `answers`. Returns false when the
   * request is gone or is not a question.
   */
  answerQuestion(id: string, answers: Record<string, string>): boolean {
    for (const rec of this.records.values()) {
      const pending = rec.pending.find((p) => p.id === id);
      if (!pending) continue;
      const updatedInput = questionAnswerInput(pending.toolName, pending.toolInput, answers);
      if (!updatedInput) return false;
      this.resolvePermission(id, 'allow', { updatedInput });
      return true;
    }
    return false;
  }

  private release(id: string, decision: PermissionDecision = 'pass', extras?: DecisionExtras): void {
    this.clearTimeout(id);
    this.reply(id, decision, extras);
  }

  private clearTimeout(id: string): void {
    const timer = this.timeouts.get(id);
    if (timer) clearTimeout(timer);
    this.timeouts.delete(id);
  }

  // ---- tile actions ---------------------------------------------------------------------------------------

  hideSession(sessionId: string): void {
    const rec = this.records.get(sessionId);
    if (!rec) return;
    this.hiddenSessions.set(sessionId, this.tileOf(rec).name);
    this.changed();
  }

  unhideSession(sessionId: string): void {
    this.hiddenSessions.delete(sessionId);
    this.changed();
  }

  hiddenSessionList(): { sessionId: string; name: string }[] {
    return [...this.hiddenSessions].map(([sessionId, name]) => ({ sessionId, name }));
  }

  record(sessionId: string): SessionRecord | undefined {
    return this.records.get(sessionId);
  }

  /** Drops pins, order, renames and carried daily costs of sessions that no longer exist. */
  pruneConfig(): void {
    const c = this.config.config;
    const live = new Set(this.records.keys());
    this.daily.retain(live);
    const pins = c.pins.filter((id) => live.has(id));
    const order = c.order.filter((id) => live.has(id));
    const renames = Object.fromEntries(Object.entries(c.renames).filter(([id]) => live.has(id)));
    if (
      pins.length !== c.pins.length ||
      order.length !== c.order.length ||
      Object.keys(renames).length !== Object.keys(c.renames).length
    ) {
      c.pins = pins;
      c.order = order;
      c.renames = renames;
      this.config.save();
    }
  }

  // ---- snapshot -------------------------------------------------------------------------------------------

  changed(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      try {
        this.emit();
      } catch (error) {
        log.error('snapshot failed', error);
      }
    }, EMIT_DEBOUNCE_MS);
  }

  private tileOf(rec: SessionRecord): TileView {
    const c = this.config.config;
    return toTile(rec, {
      rename: c.renames[rec.sessionId] ?? null,
      pinned: c.pins.includes(rec.sessionId),
      branch: readGitBranch(rec.cwd),
    });
  }

  private isVisible(rec: SessionRecord): boolean {
    if (rec.registry === null || this.hiddenSessions.has(rec.sessionId)) return false;
    const key = (path: string): string => (process.platform === 'win32' ? path.toLowerCase() : path);
    const cwd = key(rec.cwd);
    return !this.config.config.hiddenProjects.some((p) => key(p) === cwd);
  }

  private emit(): void {
    const now = Date.now();
    const transitions: Transition[] = [];
    const tiles: TileView[] = [];
    for (const rec of this.records.values()) {
      if (!this.isVisible(rec)) {
        // A session hidden while a permission was held: hand the decision back to Claude Code's own dialog.
        for (const pending of rec.pending) this.release(pending.id);
        rec.pending = [];
        refreshView(rec, now);
        continue;
      }
      const change = refreshView(rec, now);
      if (change) this.daily.addStateTime(change.from, change.durationMs, projectName(rec.cwd));
      this.daily.sawSession(rec.sessionId);
      const tile = this.tileOf(rec);
      tiles.push(tile);
      // The first sighting is not a transition; otherwise every running session would toast on app start.
      if (change && this.shown.has(rec.sessionId)) transitions.push({ tile, state: tile.state });
      this.shown.add(rec.sessionId);
    }
    const order = this.config.config.order;
    const rank = (id: string): number => {
      const index = order.indexOf(id);
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };
    tiles.sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) || rank(a.sessionId) - rank(b.sessionId) || a.startedAt - b.startedAt,
    );
    this.listener.snapshot({ tiles, header: this.header(tiles) });
    if (transitions.length > 0) this.listener.transitions(transitions);
  }

  private ongoing(tiles: TileView[]): { state: SessionState; sinceMs: number; project: string }[] {
    return tiles.map((t) => ({ state: t.state, sinceMs: t.stateSince, project: t.project }));
  }

  /** Per-day and per-project statistics of the last `days` days, today included. */
  stats(days: number): StatsView {
    const tiles = [...this.records.values()].filter((r) => this.isVisible(r)).map((r) => this.tileOf(r));
    return this.daily.stats(days, this.ongoing(tiles));
  }

  private header(tiles: TileView[]): HeaderView {
    const count = (...states: SessionState[]): number => tiles.filter((t) => states.includes(t.state)).length;
    return {
      working: count('working', 'compacting'),
      waiting: count('needsApproval', 'needsInput'),
      done: count('done'),
      fiveHour: this.fiveHour,
      sevenDay: this.sevenDay,
      fiveHourEta: limitEta(this.fiveHourSamples, this.fiveHour?.resetsAt ? this.fiveHour.resetsAt * 1000 : null),
      today: this.daily.view(this.ongoing(tiles)),
    };
  }
}
