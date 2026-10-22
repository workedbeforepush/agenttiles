// Usage history from the transcripts in ~/.claude/projects, persisted in userData/usage.json. Each transcript is read
// once from the start and later only from where the last scan stopped, so a scan after the first costs little. Days
// stay in usage.json after Claude Code deletes old transcripts (cleanupPeriodDays).
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelUsage } from '../core/types';
import { claudeDir } from '../core/paths';
import { addUsage, mergeModelUsage, parseUsageLine, type UsageDay } from '../core/usage';
import { dateOf } from './daily';
import { log } from './log';

/** Bytes read per step; the scan yields to the event loop between steps. */
const CHUNK_BYTES = 4 * 1024 * 1024;
/** Response keys are kept this long for deduplication; copies of older responses are not expected. */
const SEEN_DAYS = 90;
const DAY_MS = 86_400_000;

interface UsageFile {
  version: 1;
  /** Read offset per transcript path: everything before it is counted. */
  offsets: Record<string, number>;
  /** Response key -> epoch ms of the response. */
  seen: Record<string, number>;
  days: Record<string, UsageDay>;
}

function empty(): UsageFile {
  return { version: 1, offsets: {}, seen: {}, days: {} };
}

/** All transcripts below `root`, subagent transcripts included. */
async function transcripts(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => join(e.parentPath, e.name));
}

export class UsageLog {
  private readonly path: string;
  private data: UsageFile;
  private scanning: Promise<boolean> | null = null;
  /** Offsets or keys changed since the last save. */
  private dirty = false;

  constructor(
    dir: string,
    private readonly root: string = join(claudeDir(), 'projects'),
    private readonly clock: () => number = Date.now,
  ) {
    this.path = join(dir, 'usage.json');
    this.data = this.load();
  }

  /** usage.json can be rebuilt from the transcripts that still exist: a damaged file starts over. */
  private load(): UsageFile {
    if (!existsSync(this.path)) return empty();
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<UsageFile> | null;
      if (raw?.version === 1 && raw.offsets && raw.seen && raw.days) return raw as UsageFile;
    } catch {
      // fall through
    }
    log.warn('usage.json was unreadable and has been reset');
    return empty();
  }

  /** Reads what the transcripts gained since the last scan. Resolves true when usage changed. */
  scan(): Promise<boolean> {
    this.scanning ??= this.runScan().finally(() => {
      this.scanning = null;
    });
    return this.scanning;
  }

  private async runScan(): Promise<boolean> {
    let changed = false;
    const paths = await transcripts(this.root);
    for (const path of paths) {
      try {
        changed = (await this.readFile(path)) || changed;
      } catch (error) {
        log.debug(`usage ${path}: ${(error as Error).message}`);
      }
    }
    // Deleted transcripts: their usage stays in `days`, their offsets go.
    const existing = new Set(paths);
    for (const path of Object.keys(this.data.offsets)) {
      if (!existing.has(path)) {
        delete this.data.offsets[path];
        this.dirty = true;
      }
    }
    const horizon = this.clock() - SEEN_DAYS * DAY_MS;
    for (const [key, at] of Object.entries(this.data.seen)) {
      if (at < horizon) {
        delete this.data.seen[key];
        this.dirty = true;
      }
    }
    if (this.dirty) this.save();
    return changed;
  }

  private async readFile(path: string): Promise<boolean> {
    const { size } = await stat(path);
    let offset = this.data.offsets[path] ?? 0;
    // A shorter file was replaced: read it again, the keys keep responses from counting twice.
    if (size < offset) offset = 0;
    if (size === offset) return false;
    let changed = false;
    const handle = await open(path, 'r');
    try {
      // Split on newline bytes, not decoded text: a chunk can end inside a multi-byte character.
      let rest = Buffer.alloc(0);
      while (offset < size) {
        const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, size - offset));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
        const bytes = Buffer.concat([rest, chunk.subarray(0, bytesRead)]);
        const end = bytes.lastIndexOf(0x0a);
        // Only complete lines count; a line still being written is read again next time.
        if (end >= 0) {
          for (const line of bytes.toString('utf8', 0, end).split('\n')) changed = this.add(line) || changed;
        }
        rest = bytes.subarray(end + 1);
        this.data.offsets[path] = offset - rest.length;
        this.dirty = true;
        await new Promise((resolve) => setImmediate(resolve));
      }
    } finally {
      await handle.close();
    }
    return changed;
  }

  private add(line: string): boolean {
    const entry = parseUsageLine(line);
    if (!entry || entry.key in this.data.seen) return false;
    this.data.seen[entry.key] = entry.at;
    addUsage((this.data.days[dateOf(entry.at)] ??= Object.create(null) as UsageDay), entry);
    return true;
  }

  private save(): void {
    try {
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data));
      renameSync(tmp, this.path);
      this.dirty = false;
    } catch (error) {
      log.warn(`usage.json could not be written: ${(error as Error).message}`);
    }
  }

  /** Usage of one day (YYYY-MM-DD) per project and model. */
  day(date: string): UsageDay {
    return this.data.days[date] ?? {};
  }

  /** Usage per model over the given days. */
  models(dates: string[]): Record<string, ModelUsage> {
    const result: Record<string, ModelUsage> = Object.create(null) as Record<string, ModelUsage>;
    for (const date of dates) for (const models of Object.values(this.day(date))) mergeModelUsage(result, models);
    return result;
  }

  /** Oldest day with usage, or null. */
  firstDate(): string | null {
    return Object.keys(this.data.days).sort()[0] ?? null;
  }

  allDays(): Record<string, UsageDay> {
    return this.data.days;
  }
}
