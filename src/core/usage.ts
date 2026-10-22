// Token usage from Claude Code transcripts: one entry per API response, summed per day, project and model.
import type { ModelUsage } from './types';
import { projectName } from './paths';
import { usageCost, type TokenUsage } from './pricing';

export interface UsageEntry extends TokenUsage {
  /**
   * `message.id` + `requestId`. One response is written as several lines (one per content block), and resumed or
   * forked sessions copy earlier lines into a new transcript: the key counts each response once.
   */
  key: string;
  at: number;
  project: string;
}

/** Per project, per model; `costUsd` is null when a model has no known price. */
export type UsageDay = Record<string, Record<string, ModelUsage>>;

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** Parses one transcript line; null for anything that is not an API response with usage. */
export function parseUsageLine(line: string): UsageEntry | null {
  // Most lines carry no usage: skip them without parsing.
  if (!line.includes('"usage"')) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (raw['type'] !== 'assistant') return null;
  const message = raw['message'] as Record<string, unknown> | undefined;
  const usage = message?.['usage'] as Record<string, unknown> | undefined;
  const model = message?.['model'];
  const id = message?.['id'];
  const at = Date.parse(String(raw['timestamp']));
  const cwd = raw['cwd'];
  // `<synthetic>` marks messages Claude Code wrote itself (errors, interruptions): no API call behind them.
  if (!usage || typeof model !== 'string' || model.startsWith('<') || typeof id !== 'string') return null;
  if (!Number.isFinite(at) || typeof cwd !== 'string') return null;
  const creation = usage['cache_creation'] as Record<string, unknown> | undefined;
  const serverTools = usage['server_tool_use'] as Record<string, unknown> | undefined;
  return {
    key: `${id}:${String(raw['requestId'] ?? '')}`,
    at,
    project: projectName(cwd),
    model,
    inputTokens: num(usage['input_tokens']),
    outputTokens: num(usage['output_tokens']),
    // Older transcripts have only the total; it was written at the default 5 minute duration.
    cacheWrite5mTokens: creation ? num(creation['ephemeral_5m_input_tokens']) : num(usage['cache_creation_input_tokens']),
    cacheWrite1hTokens: creation ? num(creation['ephemeral_1h_input_tokens']) : 0,
    cacheReadTokens: num(usage['cache_read_input_tokens']),
    webSearches: num(serverTools?.['web_search_requests']),
    fast: usage['speed'] === 'fast',
    usOnly: usage['inference_geo'] === 'us',
  };
}

export function emptyModelUsage(): ModelUsage {
  return { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, costUsd: 0 };
}

/** Adds an entry to a day. */
export function addUsage(day: UsageDay, e: UsageEntry): void {
  const projects = (day[e.project] ??= Object.create(null) as Record<string, ModelUsage>);
  const m = (projects[e.model] ??= emptyModelUsage());
  m.inputTokens += e.inputTokens;
  m.outputTokens += e.outputTokens;
  m.cacheWriteTokens += e.cacheWrite5mTokens + e.cacheWrite1hTokens;
  m.cacheReadTokens += e.cacheReadTokens;
  const cost = usageCost(e);
  m.costUsd = m.costUsd === null || cost === null ? null : m.costUsd + cost;
}

/** Sums `from` into `into`, model by model. */
export function mergeModelUsage(into: Record<string, ModelUsage>, from: Record<string, ModelUsage>): void {
  for (const [model, m] of Object.entries(from)) {
    const t = (into[model] ??= emptyModelUsage());
    t.inputTokens += m.inputTokens;
    t.outputTokens += m.outputTokens;
    t.cacheWriteTokens += m.cacheWriteTokens;
    t.cacheReadTokens += m.cacheReadTokens;
    t.costUsd = t.costUsd === null || m.costUsd === null ? null : t.costUsd + m.costUsd;
  }
}

/** Cost of a project's day; unpriced models count as 0. */
export function projectCost(models: Record<string, ModelUsage>): number {
  return Object.values(models).reduce((sum, m) => sum + (m.costUsd ?? 0), 0);
}

const CSV_HEADER = 'date,project,model,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens,cost_usd';

/** Quotes where needed; a leading = + - @ is defused so spreadsheets do not run a folder name as a formula. */
function csvField(value: string): string {
  const text = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One row per day, project and model, oldest day first; an unknown cost is an empty field. */
export function usageCsv(days: Record<string, UsageDay>): string {
  const rows = [CSV_HEADER];
  for (const date of Object.keys(days).sort()) {
    for (const [project, models] of Object.entries(days[date] ?? {})) {
      for (const [model, m] of Object.entries(models)) {
        const cost = m.costUsd === null ? '' : m.costUsd.toFixed(4);
        rows.push(
          [date, csvField(project), csvField(model), m.inputTokens, m.outputTokens, m.cacheWriteTokens, m.cacheReadTokens, cost].join(','),
        );
      }
    }
  }
  return `${rows.join('\n')}\n`;
}
