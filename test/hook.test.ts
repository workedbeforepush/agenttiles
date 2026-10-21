// Round trip: the bundled hook script, run by Node, against an in-process IPC server on a private endpoint.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LineSplitter, encode, type HookMessage } from '../src/core/protocol';

const dir = mkdtempSync(join(tmpdir(), 'ccdash-test-'));
const hookPath = join(dir, 'ccdash-hook.js');
const endpointFile = join(dir, 'ipc-token');
const pipe =
  process.platform === 'win32' ? `\\\\.\\pipe\\ccdash-test-${process.pid}` : join(dir, 'ccdash-test.sock');
const missing = process.platform === 'win32' ? `\\\\.\\pipe\\ccdash-missing-${process.pid}` : join(dir, 'missing.sock');

function writeEndpoint(path: string): void {
  writeFileSync(endpointFile, JSON.stringify({ path, token: 'test-token' }));
}

function runHook(mode: string, input: unknown): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [hookPath, mode]);
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.on('exit', (code) => resolve({ code, stdout }));
    child.stdin.end(JSON.stringify(input));
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise((r) => setTimeout(r, 10));
}

let server: Server;
const received: HookMessage[] = [];
let onMessage: (message: HookMessage, socket: Socket) => void = () => undefined;

beforeAll(async () => {
  await build({
    entryPoints: [join(__dirname, '..', 'src', 'hook', 'index.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: hookPath,
    logLevel: 'silent',
  });
  server = createServer((socket) => {
    const splitter = new LineSplitter();
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      for (const line of splitter.push(chunk) ?? []) {
        const message = JSON.parse(line) as HookMessage;
        received.push(message);
        onMessage(message, socket);
      }
    });
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(pipe, resolve));
  writeEndpoint(pipe);
});

afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ccdash-hook', () => {
  it('forwards a hook event with token and start time, and exits 0 without output', async () => {
    const input = { session_id: 's1', hook_event_name: 'Stop', cwd: '/x' };
    const before = received.length;
    const started = Date.now();
    const result = await runHook('hook', input);
    expect(result).toEqual({ code: 0, stdout: '' });
    await waitFor(() => received.length > before);
    const message = received.at(-1);
    expect(message).toMatchObject({ kind: 'event', token: 'test-token', payload: input });
    expect(message?.ts).toBeGreaterThanOrEqual(started - 1000);
  });

  it('waits for a permission decision and prints it', async () => {
    onMessage = (message, socket) => {
      if (message.kind === 'permission') socket.write(encode({ id: message.id, decision: 'allow' }));
    };
    const result = await runHook('hook', { session_id: 's1', hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
    onMessage = () => undefined;
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });
  });

  it('passes an updatedInput from the app through to Claude Code', async () => {
    const updatedInput = { questions: [], answers: { 'Which color?': 'Blue' } };
    onMessage = (message, socket) => {
      if (message.kind === 'permission') socket.write(encode({ id: message.id, decision: 'allow', updatedInput }));
    };
    const result = await runHook('hook', { session_id: 's1', hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion' });
    onMessage = () => undefined;
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput } },
    });
  });

  it('ignores replies for other requests and prints {} when the app closes the connection', async () => {
    onMessage = (message, socket) => {
      if (message.kind === 'permission') socket.end(encode({ id: 'someone-else', decision: 'allow' }));
    };
    const result = await runHook('hook', { session_id: 's1', hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
    onMessage = () => undefined;
    expect(result).toEqual({ code: 0, stdout: '{}' });
  });

  it('forwards statusline data and passes through the chained statusline output', async () => {
    writeFileSync(
      join(dir, 'statusline-chain.json'),
      JSON.stringify({ type: 'command', command: `"${process.execPath.replace(/\\/g, '/')}" -e "process.stdout.write('chained')"` }),
    );
    const payload = { session_id: 's1', model: { display_name: 'Opus' }, cost: { total_cost_usd: 0.5 } };
    const before = received.length;
    const result = await runHook('statusline', payload);
    expect(result).toEqual({ code: 0, stdout: 'chained' });
    await waitFor(() => received.length > before);
    expect(received.at(-1)).toMatchObject({ kind: 'statusline', token: 'test-token', payload });
  });

  it('is silent and fast when the app is not running', async () => {
    writeEndpoint(missing);
    const started = Date.now();
    const event = await runHook('hook', { session_id: 's1', hook_event_name: 'Stop' });
    const permission = await runHook('hook', { session_id: 's1', hook_event_name: 'PermissionRequest' });
    writeEndpoint(pipe);
    expect(event).toEqual({ code: 0, stdout: '' });
    expect(permission).toEqual({ code: 0, stdout: '{}' });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('sends nothing without an endpoint file and passes permissions back to Claude Code', async () => {
    rmSync(endpointFile);
    const before = received.length;
    const event = await runHook('hook', { session_id: 's1', hook_event_name: 'Stop' });
    const permission = await runHook('hook', { session_id: 's1', hook_event_name: 'PermissionRequest' });
    await new Promise((r) => setTimeout(r, 100));
    expect(event).toEqual({ code: 0, stdout: '' });
    expect(permission).toEqual({ code: 0, stdout: '{}' });
    expect(received.length).toBe(before);
  });
});
