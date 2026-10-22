// Reader for Claude Code's undocumented live session registry: ~/.claude/sessions/<pid>.json.
// The sibling <pid>.<hash>.key files hold credentials and are never read.

export interface RegistryEntry {
  pid: number;
  sessionId: string;
  cwd: string;
  name: string | null;
  nameSource: string | null;
  status: string;
  waitingFor: string | null;
  statusUpdatedAt: number;
  startedAt: number;
  procStart: string | null;
  /** `interactive` for a terminal session, `bg` for a background session (`claude --bg`). */
  kind: string;
  /** Background sessions only: the short id `claude attach` / `claude stop` take. */
  jobId: string | null;
  version: string | null;
}

const REGISTRY_FILE = /^(\d+)\.json$/;

export function isRegistryFileName(fileName: string): boolean {
  return REGISTRY_FILE.test(fileName);
}

/**
 * Returns the first complete top-level JSON object in the text. Claude Code occasionally leaves a stray trailing
 * brace in registry files, which breaks a plain JSON.parse.
 */
export function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Parses one registry file. Returns null when the content is not a usable session entry. */
export function parseRegistryEntry(text: string): RegistryEntry | null {
  const json = firstJsonObject(text);
  if (json === null) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  const pid = num(raw['pid']);
  const sessionId = str(raw['sessionId']);
  const cwd = str(raw['cwd']);
  if (pid === null || sessionId === null || cwd === null) return null;
  return {
    pid,
    sessionId,
    cwd,
    name: str(raw['name']),
    nameSource: str(raw['nameSource']),
    status: str(raw['status']) ?? 'unknown',
    waitingFor: str(raw['waitingFor']),
    statusUpdatedAt: num(raw['statusUpdatedAt']) ?? num(raw['updatedAt']) ?? 0,
    startedAt: num(raw['startedAt']) ?? 0,
    procStart: str(raw['procStart']),
    kind: str(raw['kind']) ?? 'interactive',
    jobId: str(raw['jobId']),
    version: str(raw['version']),
  };
}
