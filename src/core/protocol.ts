// IPC protocol between the hook script and the app: newline-delimited JSON over a named pipe / unix socket.
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

export const PROTOCOL_VERSION = 2;

/**
 * AgentTiles writes this file into its userData directory on every start. It holds a random endpoint (pipe name or socket
 * path) and a random token. Only the user can read it and the hook script lives next to it, so other local users can
 * neither find the endpoint to squat it nor forge messages.
 */
export const ENDPOINT_FILE_NAME = 'ipc-token';

export interface Endpoint {
  path: string;
  token: string;
}

/** A fresh random endpoint: a named pipe on Windows, a socket in a private directory elsewhere. */
export function newEndpoint(privateDir: string): Endpoint {
  const id = randomBytes(8).toString('hex');
  const path = process.platform === 'win32' ? `\\\\.\\pipe\\agenttiles-${id}` : join(privateDir, `agenttiles-${id}.sock`);
  return { path, token: randomBytes(32).toString('hex') };
}

export function parseEndpoint(text: string): Endpoint | null {
  try {
    const value = JSON.parse(text) as Partial<Endpoint> | null;
    if (value && typeof value.path === 'string' && typeof value.token === 'string') {
      return { path: value.path, token: value.token };
    }
  } catch {
    // fall through
  }
  return null;
}

interface Envelope {
  v: number;
  token: string;
  /** Epoch ms when the hook process started, i.e. close to when Claude Code fired the event. */
  ts: number;
}

export type HookMessage =
  | (Envelope & { kind: 'event'; payload: Record<string, unknown> })
  | (Envelope & { kind: 'permission'; id: string; payload: Record<string, unknown> })
  | (Envelope & { kind: 'statusline'; payload: Record<string, unknown> });

export type PermissionDecision = 'allow' | 'deny' | 'pass';

export interface DecisionExtras {
  /** For "allow": replaces the tool input, e.g. AskUserQuestion with the user's answers filled in. */
  updatedInput?: Record<string, unknown>;
  /** For "allow": permission updates to apply, e.g. Claude Code's "always allow" suggestion or a mode switch. */
  updatedPermissions?: Record<string, unknown>[];
  /** For "deny": what Claude is told. */
  message?: string;
}

export interface PermissionReply extends DecisionExtras {
  id: string;
  decision: PermissionDecision;
}

const MAX_MESSAGE = 4000;

/** The well-formed extras of an untrusted reply; fields that do not fit the decision are dropped. */
export function replyExtras(reply: PermissionReply): DecisionExtras {
  const extras: DecisionExtras = {};
  const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (reply.decision === 'allow') {
    if (isObject(reply.updatedInput)) extras.updatedInput = reply.updatedInput;
    if (Array.isArray(reply.updatedPermissions) && reply.updatedPermissions.every(isObject)) {
      extras.updatedPermissions = reply.updatedPermissions;
    }
  }
  if (reply.decision === 'deny' && typeof reply.message === 'string' && reply.message.trim().length > 0) {
    extras.message = reply.message.slice(0, MAX_MESSAGE);
  }
  return extras;
}

const KINDS = new Set(['event', 'permission', 'statusline']);

/** Structural check of an untrusted line; returns null for anything that is not a well-formed message. */
export function parseMessage(line: string): HookMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const m = value as Record<string, unknown>;
  if (typeof m['token'] !== 'string' || typeof m['kind'] !== 'string' || !KINDS.has(m['kind'])) return null;
  if (typeof m['ts'] !== 'number' || !Number.isFinite(m['ts'])) return null;
  const payload = m['payload'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (m['kind'] === 'permission' && typeof m['id'] !== 'string') return null;
  return m as unknown as HookMessage;
}

export const MAX_LINE_BYTES = 1024 * 1024;

/** Splits a stream of chunks into complete lines; keeps the trailing partial line buffered. */
export class LineSplitter {
  private buffer = '';

  /** Returns the complete lines, or null when a line exceeds MAX_LINE_BYTES (the stream should be dropped). */
  push(chunk: string): string[] | null {
    this.buffer += chunk;
    const parts = this.buffer.split('\n');
    this.buffer = parts.pop() ?? '';
    if (this.buffer.length > MAX_LINE_BYTES || parts.some((line) => line.length > MAX_LINE_BYTES)) return null;
    return parts.filter((line) => line.trim().length > 0);
  }
}

export function encode(message: HookMessage | PermissionReply): string {
  return `${JSON.stringify(message)}\n`;
}

export function permissionOutput(decision: PermissionDecision, extras: DecisionExtras = {}): string {
  if (decision === 'pass') return '{}';
  const body =
    decision === 'allow'
      ? {
          behavior: 'allow',
          ...(extras.updatedInput ? { updatedInput: extras.updatedInput } : {}),
          ...(extras.updatedPermissions?.length ? { updatedPermissions: extras.updatedPermissions } : {}),
        }
      : { behavior: 'deny', message: extras.message ?? 'Denied from AgentTiles.' };
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: body },
  });
}
