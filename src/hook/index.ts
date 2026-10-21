// agenttiles-hook.js: invoked by Claude Code as a command hook ("hook") or as the statusline command ("statusline").
// Forwards the JSON from stdin to the AgentTiles app. Silent and exit code 0 when the app is not running.
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ENDPOINT_FILE_NAME,
  PROTOCOL_VERSION,
  LineSplitter,
  encode,
  parseEndpoint,
  permissionOutput,
  replyExtras,
  type DecisionExtras,
  type Endpoint,
  type HookMessage,
  type PermissionDecision,
  type PermissionReply,
} from '../core/protocol';

/** Taken first thing, so it is close to when Claude Code fired the event. */
const STARTED_AT = Date.now();

const LOG_FILE = join(__dirname, 'hook.log');
const CHAIN_FILE = join(__dirname, 'statusline-chain.json');
const ENDPOINT_FILE = join(__dirname, ENDPOINT_FILE_NAME);
const LOG_CAP_BYTES = 1024 * 1024;
const SEND_TIMEOUT_MS = 1000;
const CHAIN_TIMEOUT_MS = 5000;
/** Hard deadlines so a wedged app can never pile up hook processes (permission requests are bounded by Claude). */
const EVENT_DEADLINE_MS = 3000;
const STATUSLINE_DEADLINE_MS = CHAIN_TIMEOUT_MS + 3000;
const NOT_RUNNING = new Set(['ENOENT', 'ECONNREFUSED', 'EPIPE', 'ECONNRESET']);

function logError(message: string): void {
  try {
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > LOG_CAP_BYTES) writeFileSync(LOG_FILE, '');
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Logging must never break Claude Code.
  }
}

/** The app writes a fresh endpoint on every start. No file means AgentTiles never ran here: behave as not running. */
function readEndpoint(): Endpoint | null {
  try {
    return parseEndpoint(readFileSync(ENDPOINT_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function connect(path: string): Promise<Socket | null> {
  return new Promise((resolve) => {
    const socket = createConnection(path);
    socket.once('connect', () => resolve(socket));
    socket.once('error', (error: NodeJS.ErrnoException) => {
      if (!NOT_RUNNING.has(error.code ?? '')) logError(`connect failed: ${error.message}`);
      resolve(null);
    });
  });
}

/** Sends one message and closes the connection. Gives up after SEND_TIMEOUT_MS. */
async function send(endpoint: Endpoint, message: HookMessage): Promise<void> {
  const socket = await connect(endpoint.path);
  if (!socket) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      logError('send timeout');
      socket.destroy();
      resolve();
    }, SEND_TIMEOUT_MS);
    socket.on('error', () => undefined);
    socket.end(encode(message), () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

interface Answer {
  decision: PermissionDecision;
  extras?: DecisionExtras;
}

/** Sends a permission request and waits for the app's decision. "pass" when the app goes away. */
async function requestPermission(endpoint: Endpoint, payload: Record<string, unknown>): Promise<Answer> {
  const socket = await connect(endpoint.path);
  if (!socket) return { decision: 'pass' };
  const id = randomUUID();
  return new Promise((resolve) => {
    const splitter = new LineSplitter();
    let settled = false;
    const finish = (answer: Answer): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(answer);
    };
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      const lines = splitter.push(chunk);
      if (lines === null) {
        logError('reply too long');
        finish({ decision: 'pass' });
        return;
      }
      for (const line of lines) {
        try {
          const reply = JSON.parse(line) as PermissionReply;
          if (reply.id !== id || !['allow', 'deny', 'pass'].includes(reply.decision)) continue;
          finish({ decision: reply.decision, extras: replyExtras(reply) });
        } catch {
          logError(`invalid reply: ${line.slice(0, 200)}`);
        }
      }
    });
    socket.on('error', () => finish({ decision: 'pass' }));
    socket.on('close', () => finish({ decision: 'pass' }));
    socket.write(encode({ v: PROTOCOL_VERSION, token: endpoint.token, ts: STARTED_AT, kind: 'permission', id, payload }));
  });
}

function chainShell(command: string): { file: string; args: string[] } {
  if (process.platform !== 'win32') return { file: '/bin/sh', args: ['-c', command] };
  const bash = process.env['CLAUDE_CODE_GIT_BASH_PATH'] ?? 'C:\\Program Files\\Git\\bin\\bash.exe';
  if (existsSync(bash)) return { file: bash, args: ['-c', command] };
  return { file: process.env['ComSpec'] ?? 'cmd.exe', args: ['/d', '/s', '/c', command] };
}

/** Runs the statusline command that was configured before AgentTiles, if any, and returns its output. */
function runChain(input: string): string {
  if (!existsSync(CHAIN_FILE)) return '';
  try {
    const chain = JSON.parse(readFileSync(CHAIN_FILE, 'utf8')) as { command?: unknown };
    if (typeof chain.command !== 'string' || chain.command.length === 0) return '';
    const { file, args } = chainShell(chain.command);
    const result = spawnSync(file, args, { input, encoding: 'utf8', windowsHide: true, timeout: CHAIN_TIMEOUT_MS });
    if (result.error) logError(`statusline chain failed: ${result.error.message}`);
    return result.stdout ?? '';
  } catch (error) {
    logError(`statusline chain failed: ${(error as Error).message}`);
    return '';
  }
}

function parse(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  logError(`invalid hook input: ${raw.slice(0, 200)}`);
  return null;
}

function deadline(ms: number): void {
  setTimeout(() => {
    logError(`deadline of ${ms} ms exceeded`);
    process.exit(0);
  }, ms).unref();
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const raw = await readStdin();
  const endpoint = readEndpoint();

  if (mode === 'statusline') {
    deadline(STATUSLINE_DEADLINE_MS);
    const payload = parse(raw);
    if (payload && endpoint) {
      await send(endpoint, { v: PROTOCOL_VERSION, token: endpoint.token, ts: STARTED_AT, kind: 'statusline', payload });
    }
    process.stdout.write(runChain(raw));
    return;
  }

  if (mode !== 'hook') {
    logError(`unknown mode: ${String(mode)}`);
    return;
  }
  const payload = parse(raw);
  if (!payload) return;
  if (payload['hook_event_name'] === 'PermissionRequest') {
    const answer = endpoint ? await requestPermission(endpoint, payload) : { decision: 'pass' as const };
    process.stdout.write(permissionOutput(answer.decision, answer.extras));
    return;
  }
  deadline(EVENT_DEADLINE_MS);
  if (endpoint) await send(endpoint, { v: PROTOCOL_VERSION, token: endpoint.token, ts: STARTED_AT, kind: 'event', payload });
}

main()
  .catch((error: unknown) => logError(`fatal: ${(error as Error).stack ?? String(error)}`))
  // Exit only after stdout is flushed; pipes on Windows are asynchronous.
  .finally(() => process.stdout.write('', () => process.exit(0)));
