// Local IPC server receiving hook messages (named pipe on Windows, unix socket in a private directory elsewhere).
import { createServer, type Server, type Socket } from 'node:net';
import { existsSync, unlinkSync } from 'node:fs';
import {
  LineSplitter,
  encode,
  parseMessage,
  type Endpoint,
  type DecisionExtras,
  type PermissionDecision,
} from '../core/protocol';
import { log } from './log';

/** Unauthenticated connections are dropped after this long without a valid message. */
const AUTH_TIMEOUT_MS = 10_000;
const MAX_CONNECTIONS = 256;

export interface IpcHandlers {
  onEvent(payload: Record<string, unknown>, ts: number): void;
  onStatusline(payload: Record<string, unknown>): void;
  onPermission(id: string, payload: Record<string, unknown>, ts: number): void;
  /** The hook process holding a permission went away (killed by Claude Code or timed out). */
  onPermissionGone(id: string): void;
}

export class IpcServer {
  listening = false;
  private server: Server | null = null;
  private readonly held = new Map<string, Socket>();

  constructor(
    private readonly endpoint: Endpoint,
    private readonly handlers: IpcHandlers,
  ) {}

  get path(): string {
    return this.endpoint.path;
  }

  start(): Promise<void> {
    if (process.platform !== 'win32' && existsSync(this.path)) unlinkSync(this.path);
    const server = createServer((socket) => this.accept(socket));
    server.maxConnections = MAX_CONNECTIONS;
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      // Windows: elevated and non-elevated Claude Code sessions must both connect, so the pipe is open to every local
      // process; the random name and the token keep others out. Elsewhere the socket lives in a 0700 directory.
      const openToAll = process.platform === 'win32';
      server.listen({ path: this.path, readableAll: openToAll, writableAll: openToAll }, () => {
        server.off('error', reject);
        server.on('error', (error) => log.error('ipc server error', error));
        this.listening = true;
        log.info(`ipc listening on ${this.path}`);
        resolve();
      });
    });
  }

  stop(): void {
    for (const id of [...this.held.keys()]) this.reply(id, 'pass');
    this.server?.close();
    this.listening = false;
  }

  /** Sends the decision to the waiting hook process. Returns false when it is no longer connected. */
  reply(id: string, decision: PermissionDecision, extras: DecisionExtras = {}): boolean {
    const socket = this.held.get(id);
    if (!socket) return false;
    this.held.delete(id);
    socket.end(encode({ id, decision, ...extras }));
    return true;
  }

  private accept(socket: Socket): void {
    const splitter = new LineSplitter();
    socket.setEncoding('utf8');
    socket.setTimeout(AUTH_TIMEOUT_MS, () => {
      log.debug('ipc: idle unauthenticated connection dropped');
      socket.destroy();
    });
    socket.on('data', (chunk: string) => {
      const lines = splitter.push(chunk);
      if (lines === null) {
        log.warn('ipc: line too long, connection dropped');
        socket.destroy();
        return;
      }
      for (const line of lines) {
        try {
          this.handleLine(socket, line);
        } catch (error) {
          log.error('ipc: handling a message failed', error);
          socket.destroy();
          return;
        }
      }
    });
    socket.on('error', (error) => log.debug(`ipc client error: ${error.message}`));
    socket.on('close', () => {
      for (const [id, held] of this.held) {
        if (held !== socket) continue;
        this.held.delete(id);
        this.handlers.onPermissionGone(id);
      }
    });
  }

  private handleLine(socket: Socket, line: string): void {
    const message = parseMessage(line);
    if (!message || message.token !== this.endpoint.token) {
      log.warn('ipc: malformed or unauthenticated message rejected');
      socket.destroy();
      return;
    }
    // Authenticated: a held permission connection must stay open as long as the request is pending.
    socket.setTimeout(0);
    switch (message.kind) {
      case 'event':
        this.handlers.onEvent(message.payload, message.ts);
        break;
      case 'statusline':
        this.handlers.onStatusline(message.payload);
        break;
      case 'permission':
        this.held.set(message.id, socket);
        this.handlers.onPermission(message.id, message.payload, message.ts);
        break;
    }
  }
}
