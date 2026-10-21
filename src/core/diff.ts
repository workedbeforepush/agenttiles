// Line diffs of file-changing tool calls, shown before the user allows them.
import type { DiffLine, DiffView } from './types';

/** Above this many cells (old lines × new lines) the LCS table gets too big; the change is shown as replace-all. */
const MAX_CELLS = 4_000_000;
/** Unchanged lines kept around each change; longer unchanged runs collapse into one "skip" line. */
const CONTEXT = 3;
const MAX_LINES = 400;
/** MultiEdit: edits beyond this many are summarised in one line. */
const MAX_EDITS = 20;

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/**
 * Line diff: common leading and trailing lines first, then a longest common subsequence of the rest (deletions
 * before additions inside a changed block). The trimming keeps one changed line in a big file cheap and exact.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const context = (lines: string[]): DiffLine[] => lines.map((text) => ({ kind: 'ctx' as const, text }));
  return [...context(a.slice(0, start)), ...lcsDiff(a.slice(start, endA), b.slice(start, endB)), ...context(a.slice(endA))];
}

function lcsDiff(a: string[], b: string[]): DiffLine[] {
  if (a.length * b.length > MAX_CELLS) {
    return [...a.map((text) => ({ kind: 'del' as const, text })), ...b.map((text) => ({ kind: 'add' as const, text }))];
  }
  // lcs[i][j] = length of the LCS of a[i..] and b[j..], stored flat.
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j] ? lcs[(i + 1) * width + j + 1]! + 1 : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: 'ctx', text: a[i]! });
      i++;
      j++;
    } else if (j >= b.length || (i < a.length && lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!)) {
      lines.push({ kind: 'del', text: a[i]! });
      i++;
    } else {
      lines.push({ kind: 'add', text: b[j]! });
      j++;
    }
  }
  return lines;
}

/** Keeps CONTEXT unchanged lines around changes and replaces longer unchanged runs by a "skip" line. */
export function collapse(lines: DiffLine[]): DiffLine[] {
  const changed = lines.map((l) => l.kind !== 'ctx');
  const near = (index: number): boolean => {
    for (let k = Math.max(0, index - CONTEXT); k <= Math.min(lines.length - 1, index + CONTEXT); k++) {
      if (changed[k]) return true;
    }
    return false;
  };
  const result: DiffLine[] = [];
  let skipped = 0;
  lines.forEach((line, index) => {
    if (line.kind !== 'ctx' || near(index)) {
      if (skipped > 0) result.push({ kind: 'skip', text: `${skipped} unchanged line${skipped === 1 ? '' : 's'}` });
      skipped = 0;
      result.push(line);
    } else {
      skipped++;
    }
  });
  if (skipped > 0) result.push({ kind: 'skip', text: `${skipped} unchanged line${skipped === 1 ? '' : 's'}` });
  return result;
}

function str(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === 'string' ? value : null;
}

/**
 * The diff a file tool call would make, or null for other tools. `currentFile` is the file's content today (only
 * needed for Write; null when the file does not exist).
 */
export function toolDiff(toolName: string, toolInput: unknown, currentFile: string | null): DiffView | null {
  if (!toolInput || typeof toolInput !== 'object') return null;
  const input = toolInput as Record<string, unknown>;
  const path = str(input, 'file_path');
  if (!path) return null;
  let lines: DiffLine[];
  let note: string | null = null;
  switch (toolName) {
    case 'Edit': {
      const before = str(input, 'old_string');
      const after = str(input, 'new_string');
      if (before === null || after === null) return null;
      lines = lineDiff(before, after);
      if (input['replace_all'] === true) note = 'every occurrence';
      break;
    }
    case 'MultiEdit': {
      const edits = Array.isArray(input['edits']) ? (input['edits'] as unknown[]) : [];
      lines = [];
      for (const [index, raw] of edits.slice(0, MAX_EDITS).entries()) {
        const edit = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        const before = str(edit, 'old_string');
        const after = str(edit, 'new_string');
        if (before === null || after === null) return null;
        if (index > 0) lines.push({ kind: 'skip', text: `edit ${index + 1}` });
        lines.push(...lineDiff(before, after));
      }
      if (edits.length > MAX_EDITS) lines.push({ kind: 'skip', text: `${edits.length - MAX_EDITS} more edits` });
      break;
    }
    case 'Write': {
      const content = str(input, 'content');
      if (content === null) return null;
      const current = currentFile?.replace(/^\uFEFF/, '') ?? null;
      lines = collapse(lineDiff(current ?? '', content));
      const crlf = (text: string): boolean => text.includes('\r\n');
      if (current === null) note = 'new file';
      else if (crlf(current) !== crlf(content)) note = crlf(content) ? 'line endings change to CRLF' : 'line endings change to LF';
      break;
    }
    default:
      return null;
  }
  const added = lines.filter((l) => l.kind === 'add').length;
  const removed = lines.filter((l) => l.kind === 'del').length;
  return { path, lines: lines.slice(0, MAX_LINES), truncated: lines.length > MAX_LINES, added, removed, note };
}
