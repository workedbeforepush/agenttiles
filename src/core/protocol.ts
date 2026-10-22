// IPC protocol between the hook script and the app: newline-delimited JSON over a named pipe / unix socket.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';

export const PROTOCOL_VERSION = 3;

/**
 * AgentTiles writes this file into its userData directory on every start. It holds a random endpoint (pipe name or socket
 * path) and a random token. Only the user can read it and the hook script lives next to it, so other local users cannot
 * forge messages. The endpoint itself is not secret on Windows (anyone can list the pipes), and the file outlives a
 * crash: before sending anything the hook asks the endpoint to prove it knows the token (see `proofOf`).
 */
export const ENDPOINT_FILE_NAME = 'ipc-token';

export interface Endpoint {
  path: string;
  token: string;
}

/** A fresh random endpoint: a named pipe on Windows, a socket in a private directory elsewhere. */
export function newEndpoint(privateDir: string): Endpoint {
  const id = randomBytes(8).toString('hex');
  // Unix socket paths are limited to about 104 bytes and userData is long on macOS: keep the socket name short.
  const path = process.platform === 'win32' ? `\\\\.\\pipe\\agenttiles-${id}` : join(privateDir, `${id}.sock`);
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

/** First line of every connection: the hook's challenge to the endpoint. */
export interface Hello {
  v: number;
  kind: 'hello';
  nonce: string;
}

/** The endpoint's answer to a Hello. */
export interface Proof {
  proof: string;
}

export function newNonce(): string {
  return randomBytes(32).toString('hex');
}

/** What only an endpoint that knows the token can answer to `nonce`; the token itself never leaves the app. */
export function proofOf(token: string, nonce: string): string {
  return createHmac('sha256', token).update(nonce).digest('hex');
}

/** Compares secrets in constant time. */
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Structural check of an untrusted first line; returns the nonce of a well-formed Hello. */
export function parseHello(line: string): string | null {
  try {
    const value = JSON.parse(line) as Partial<Hello> | null;
    if (value?.kind === 'hello' && typeof value.nonce === 'string' && /^[0-9a-f]{64}$/.test(value.nonce)) return value.nonce;
  } catch {
    // fall through
  }
  return null;
}

/** True when `line` is the endpoint's correct answer to `nonce`. */
export function proofValid(line: string, token: string, nonce: string): boolean {
  try {
    const value = JSON.parse(line) as Partial<Proof> | null;
    return typeof value?.proof === 'string' && sameSecret(value.proof, proofOf(token, nonce));
  } catch {
    return false;
  }
}

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

/** Strings an oversized event keeps; the app shows summaries of tool input and prompts, never whole contents. */
const MAX_EVENT_STRING = 16 * 1024;

function cutStrings(value: unknown): unknown {
  if (typeof value === 'string') return value.length > MAX_EVENT_STRING ? value.slice(0, MAX_EVENT_STRING) : value;
  if (Array.isArray(value)) return value.map(cutStrings);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cutStrings(v)]));
  return value;
}

/**
 * An event payload as the app needs it, small enough for one line: tool_response is never read, and when the rest is
 * still too long (a big Write, a pasted prompt) long strings are cut. Permission requests are never cut: what the user
 * approves must be what Claude runs, so an oversized one is left to the terminal.
 */
export function eventPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const { tool_response: _response, ...rest } = payload;
  if (JSON.stringify(rest).length < MAX_LINE_BYTES / 2) return rest;
  return cutStrings(rest) as Record<string, unknown>;
}

export function encode(message: HookMessage | PermissionReply | Hello | Proof): string {
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
