// Incremental parser for Claude Code transcripts (~/.claude/projects/<slug>/<sessionId>.jsonl).
// Only the main chain is considered; subagent lines (isSidechain) are skipped.
import { clipText, toolSummary } from './tools';

export interface TranscriptInfo {
  aiTitle: string | null;
  model: string | null;
  lastPrompt: string | null;
  lastPromptAt: number;
  lastAssistant: string | null;
  lastAssistantAt: number;
  /** Tool call currently in flight (tool_use without a tool_result yet). */
  activeTool: string | null;
  /** Most recent tool calls, newest last (at most 3). */
  recentTools: string[];
  gitBranch: string | null;
}

export function emptyTranscriptInfo(): TranscriptInfo {
  return {
    aiTitle: null,
    model: null,
    lastPrompt: null,
    lastPromptAt: 0,
    lastAssistant: null,
    lastAssistantAt: 0,
    activeTool: null,
    recentTools: [],
    gitBranch: null,
  };
}

export const RECENT_TOOLS = 3;

export function pushRecent(list: string[], item: string): string[] {
  return [...list, item].slice(-RECENT_TOOLS);
}

const TEXT_MAX = 400;

/** What the user typed: slash and `!` commands as typed; CLI output, reminders and notifications dropped (null). */
export function promptText(raw: string): string | null {
  const command = /<command-name>([\s\S]*?)<\/command-name>/.exec(raw);
  if (command) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(raw)?.[1] ?? '';
    return `${command[1]!.trim()} ${args.trim()}`.trim();
  }
  const bash = /<bash-input>([\s\S]*?)<\/bash-input>/.exec(raw);
  if (bash) return `! ${bash[1]!.trim()}`;
  const text = raw
    .replace(/<(system-reminder|local-command-[a-z]+|bash-std(?:out|err)|task-notification)>[\s\S]*?<\/\1>/g, '')
    .trim();
  return text.length > 0 ? text : null;
}

function time(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

type Block = { type?: string; text?: string; name?: string; input?: unknown };

function blocks(content: unknown): Block[] {
  return Array.isArray(content) ? (content as Block[]) : [];
}

/** "claude-opus-5-5" -> "Opus 5.5", the marketing name style Claude Code shows. */
export function prettyModel(id: string): string {
  const parts = id.replace(/^claude-/, '').split('-');
  const name = parts.filter((p) => !/^\d+$/.test(p));
  const version = parts.filter((p) => /^\d+$/.test(p) && p.length <= 2);
  const family = name.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  return version.length > 0 ? `${family} ${version.join('.')}` : family;
}

/** Applies one transcript line to the info. Unknown or malformed lines are ignored. */
export function applyTranscriptLine(info: TranscriptInfo, line: string): void {
  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }
  if (entry['isSidechain'] === true) return;
  const type = entry['type'];

  if (type === 'ai-title' && typeof entry['aiTitle'] === 'string') {
    info.aiTitle = entry['aiTitle'];
    return;
  }

  if (type === 'attachment') {
    const attachment = entry['attachment'] as Record<string, unknown> | undefined;
    const identity = attachment?.['identity'] as Record<string, unknown> | undefined;
    if (attachment?.['type'] === 'model' && typeof identity?.['marketingName'] === 'string') {
      info.model = identity['marketingName'];
    }
    return;
  }

  const message = entry['message'] as Record<string, unknown> | undefined;
  if (!message) return;
  if (typeof entry['gitBranch'] === 'string' && entry['gitBranch'].length > 0) info.gitBranch = entry['gitBranch'];
  const at = time(entry['timestamp']);

  if (type === 'user') {
    if (entry['isMeta'] === true) return;
    const content = message['content'];
    if (typeof content === 'string') {
      const prompt = promptText(content);
      if (prompt === null) return;
      info.lastPrompt = clipText(prompt, TEXT_MAX);
      info.lastPromptAt = at;
      info.activeTool = null;
      return;
    }
    const list = blocks(content);
    if (list.some((b) => b.type === 'tool_result')) {
      info.activeTool = null;
      return;
    }
    const text = promptText(
      list
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join(' '),
    );
    if (text !== null) {
      info.lastPrompt = clipText(text, TEXT_MAX);
      info.lastPromptAt = at;
      info.activeTool = null;
    }
    return;
  }

  if (type === 'assistant') {
    if (info.model === null && typeof message['model'] === 'string') {
      info.model = prettyModel(message['model']);
    }
    for (const block of blocks(message['content'])) {
      if (block.type === 'tool_use' && typeof block.name === 'string') {
        info.activeTool = toolSummary(block.name, block.input);
        info.recentTools = pushRecent(info.recentTools, info.activeTool);
      } else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
        info.lastAssistant = clipText(block.text, TEXT_MAX);
        info.lastAssistantAt = at;
      }
    }
  }
}
