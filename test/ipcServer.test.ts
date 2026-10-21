import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_LINE_BYTES, encode, type HookMessage } from '../src/core/protocol';
import { IpcServer } from '../src/main/ipcServer';

const path =
  process.platform === 'win32' ? `\\\\.\\pipe\\agenttiles-ipc-test-${process.pid}` : join(tmpdir(), `agenttiles-ipc-${process.pid}.sock`);
const events: Record<string, unknown>[] = [];
let server: IpcServer;

function sendRaw(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(path, () => socket.end(text));
    socket.on('close', () => resolve(true));
    socket.on('error', () => resolve(false));
  });
}

function message(token: string, event: string): HookMessage {
  return { v: 2, token, ts: Date.now(), kind: 'event', payload: { hook_event_name: event } };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise((r) => setTimeout(r, 10));
}

beforeAll(async () => {
  server = new IpcServer(
    { path, token: 'secret' },
    {
      onEvent: (payload) => events.push(payload),
      onStatusline: () => undefined,
      onPermission: () => undefined,
      onPermissionGone: () => undefined,
    },
  );
  await server.start();
});

afterAll(() => server.stop());

describe('IpcServer', () => {
  it('accepts messages with the right token', async () => {
    await sendRaw(encode(message('secret', 'Stop')));
    await waitFor(() => events.length === 1);
    expect(events).toEqual([{ hook_event_name: 'Stop' }]);
  });

  it('rejects wrong tokens and malformed messages without crashing', async () => {
    await sendRaw(encode(message('guess', 'Forged')));
    for (const raw of ['null', '42', '"text"', '[]', '{}', '{"token":"secret"}', '{"token":"secret","kind":"event","ts":1,"payload":null}', '{broken']) {
      await sendRaw(`${raw}\n`);
    }
    await new Promise((r) => setTimeout(r, 100));
    expect(events).toHaveLength(1);
    // Still serving after all of that.
    await sendRaw(encode(message('secret', 'StillAlive')));
    await waitFor(() => events.length === 2);
    expect(events.at(-1)).toEqual({ hook_event_name: 'StillAlive' });
  });

  it('drops a connection that sends an oversized line', async () => {
    await sendRaw('x'.repeat(MAX_LINE_BYTES + 10));
    await sendRaw(encode(message('secret', 'AfterFlood')));
    await waitFor(() => events.length === 3);
    expect(events.at(-1)).toEqual({ hook_event_name: 'AfterFlood' });
  });
});
