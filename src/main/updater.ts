// Updates for npm installs: check the registry for a newer version, and update a global npm install from the app
// (a detached script waits until AgentTiles has quit, runs npm and starts the new version).
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { UpdateView } from '../core/types';
import { log } from './log';

export const PACKAGE = 'agenttiles';
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE}/latest`;
const LOG_TAIL_LINES = 6;

function parts(version: string): [number[], string | null] {
  const [core = '', pre = null] = version.split('-', 2) as [string, string?];
  return [core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre ?? null];
}

/** Compares x.y.z versions: negative when a < b. A pre-release (1.0.0-beta) sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const [ca, pa] = parts(a);
  const [cb, pb] = parts(b);
  for (let i = 0; i < 3; i++) {
    const d = (ca[i] ?? 0) - (cb[i] ?? 0);
    if (d !== 0) return d;
  }
  if (pa === pb) return 0;
  if (pa === null) return 1;
  if (pb === null) return -1;
  return pa < pb ? -1 : 1;
}

export function updateCommand(version: string): string {
  return `npm install -g ${PACKAGE}@${version}`;
}

/** The script that updates after AgentTiles quit: wait, install, start the new version; npm's output goes to update.log. */
export function updateScript(platform: NodeJS.Platform, version: string): { name: string; text: string } {
  if (platform === 'win32') {
    return {
      name: 'update.cmd',
      text: [
        '@echo off',
        'timeout /t 3 /nobreak >nul',
        `call ${updateCommand(version)} > "%~dp0update.log" 2>&1`,
        `call ${PACKAGE}`,
        '',
      ].join('\r\n'),
    };
  }
  return {
    name: 'update.sh',
    text: ['#!/bin/sh', 'sleep 3', `${updateCommand(version)} > "$(dirname "$0")/update.log" 2>&1`, PACKAGE, ''].join('\n'),
  };
}

function npm(args: string[]): Promise<string> {
  return new Promise((done, fail) => {
    // npm is a .cmd script on Windows, which needs a shell.
    execFile('npm', args, { encoding: 'utf8', timeout: 20_000, shell: process.platform === 'win32' }, (error, stdout) =>
      error ? fail(error) : done(stdout.trim()),
    );
  });
}

interface Marker {
  target: string;
}

export class Updater {
  private latest: string | null = null;
  private failed: string | null = null;
  private globalInstall: boolean | null = null;
  private readonly markerPath: string;

  constructor(
    private readonly userData: string,
    private readonly appDir: string,
    private readonly current: string,
  ) {
    this.markerPath = join(userData, 'update.json');
    this.readMarker();
  }

  /** An update started by the previous run: done when this is the target version, else it failed (see update.log). */
  private readMarker(): void {
    if (!existsSync(this.markerPath)) return;
    const marker = JSON.parse(readFileSync(this.markerPath, 'utf8')) as Marker;
    rmSync(this.markerPath);
    if (marker.target === this.current) {
      log.info(`updated to ${this.current}`);
      return;
    }
    const logPath = join(this.userData, 'update.log');
    const tail = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split(/\r?\n/).slice(-LOG_TAIL_LINES).join('\n') : '';
    this.failed = tail || 'npm did not install the update.';
    log.warn(`update to ${marker.target} failed: ${this.failed}`);
  }

  /** Asks the registry for the latest version. Network errors only mean "nothing new" until the next check. */
  async check(): Promise<void> {
    try {
      const response = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { version } = (await response.json()) as { version?: unknown };
      if (typeof version === 'string') this.latest = version;
    } catch (error) {
      log.debug(`update check failed: ${(error as Error).message}`);
    }
    this.globalInstall ??= await this.isGlobalNpmInstall();
  }

  /** True when this copy is the package in npm's global folder, which `npm install -g` replaces. */
  private async isGlobalNpmInstall(): Promise<boolean> {
    try {
      const root = await npm(['root', '-g']);
      const key = (p: string): string => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
      return key(join(root, PACKAGE)) === key(this.appDir);
    } catch {
      return false;
    }
  }

  view(): UpdateView {
    const available = this.latest !== null && compareVersions(this.latest, this.current) > 0 ? this.latest : null;
    return {
      current: this.current,
      available,
      command: updateCommand(available ?? 'latest'),
      canInstall: this.globalInstall === true,
      failed: this.failed,
    };
  }

  /** Starts the detached update script; the caller quits the app right after. */
  install(version: string): void {
    const script = updateScript(process.platform, version);
    const path = join(this.userData, script.name);
    writeFileSync(path, script.text, { mode: 0o755 });
    writeFileSync(this.markerPath, JSON.stringify({ target: version } satisfies Marker));
    const child =
      process.platform === 'win32'
        ? spawn('cmd.exe', ['/d', '/c', path], { detached: true, stdio: 'ignore', windowsHide: true })
        : spawn('/bin/sh', [path], { detached: true, stdio: 'ignore' });
    child.unref();
    log.info(`update to ${version} started (${path})`);
  }
}
