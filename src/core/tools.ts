// One-line summaries of tool calls for tile display.
import { basename } from 'node:path';

const DEFAULT_MAX = 80;

function clip(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function field(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function fileName(path: string): string {
  return basename(path.replace(/\\/g, '/'));
}

export function toolSummary(toolName: string, toolInput: unknown, max = DEFAULT_MAX): string {
  const input = (toolInput && typeof toolInput === 'object' ? toolInput : {}) as Record<string, unknown>;
  const pick = (): string | null => {
    switch (toolName) {
      case 'Bash':
      case 'PowerShell':
        return field(input, 'command');
      case 'Read':
      case 'Write':
      case 'Edit':
      case 'MultiEdit':
      case 'NotebookEdit': {
        const path = field(input, 'file_path') ?? field(input, 'notebook_path');
        return path ? fileName(path) : null;
      }
      case 'Grep':
      case 'Glob':
        return field(input, 'pattern');
      case 'WebFetch':
        return field(input, 'url');
      case 'WebSearch':
        return field(input, 'query');
      case 'Agent':
      case 'Task':
        return field(input, 'description');
      default: {
        const first = Object.values(input).find((v) => typeof v === 'string' && v.length > 0);
        return typeof first === 'string' ? first : null;
      }
    }
  };
  const detail = pick();
  return detail ? `${toolName}: ${clip(detail, max)}` : toolName;
}

export function clipText(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}
