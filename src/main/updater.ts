// Updates for npm installs: check the registry for a newer version, and update a global npm install from the app
// (a detached script waits until AgentTiles has quit, runs npm and starts the new version).
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { UpdateView } from '../core/types';
import type { Translate } from '../core/i18n';
import { log } from './log';
import { t as mainT } from './i18n';

export const PACKAGE = 'agenttiles';
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE}/latest`;
const RELEASES_URL = 'https://github.com/workedbeforepush/agenttiles/releases/tag/';
const LOG_TAIL_LINES = 6;
/** x.y.z with an optional pre-release: the version ends up in the update script, so nothing else gets through. */
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

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

/** The version in the registry's answer for the latest release, or null when it is missing or not x.y.z. */
export function latestVersion(body: unknown): string | null {
  const version = (body as { version?: unknown } | null)?.version;
  return typeof version === 'string' && VERSION.test(version) ? version : null;
}

/** True when `available` is newer than the version the last update toast announced, or none was announced yet. */
export function shouldAnnounce(available: string, announced: string | null): boolean {
  return announced === null || compareVersions(available, announced) > 0;
}

/** The GitHub release page of `version`; it goes to the browser, so only an x.y.z version gets through. */
export function releaseUrl(version: string): string {
  if (!VERSION.test(version)) throw new Error(`not a version: ${version}`);
  return `${RELEASES_URL}v${version}`;
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

/**
 * cmd.exe arguments that run the script at `path`. With /s, cmd strips exactly the outer quotes and keeps the inner
 * ones, so a path with & or ( stays one quoted word; the arguments go to cmd.exe verbatim.
 */
export function cmdArgs(path: string): string[] {
  return ['/d', '/s', '/c', `""${path}""`];
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

/** A failed update from the previous run: the end of npm's output, or null when npm wrote nothing. */
interface Failure {
  output: string | null;
}

export class Updater {
  private latest: string | null = null;
  private failed: Failure | null = null;
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
    // Stored untranslated: the fallback text is built in view() and follows a language switch.
    this.failed = { output: tail || null };
    log.warn(`update to ${marker.target} failed: ${tail || 'no npm output'}`);
  }

  /** Asks the registry for the latest version. Network errors only mean "nothing new" until the next check. */
  async check(): Promise<void> {
    try {
      const response = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body: unknown = await response.json();
      const version = latestVersion(body);
      if (version) this.latest = version;
      else log.warn('update check: the registry answered without a valid version');
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

  view(t: Translate = mainT): UpdateView {
    const available = this.latest !== null && compareVersions(this.latest, this.current) > 0 ? this.latest : null;
    return {
      current: this.current,
      available,
      command: updateCommand(available ?? 'latest'),
      canInstall: this.globalInstall === true,
      failed: this.failed ? (this.failed.output ?? t('main.update.npmNoInstall')) : null,
    };
  }

  /** Starts the detached update script; the caller quits the app right after. */
  /** Resolves once the update script runs; rejects when it could not start, and AgentTiles must not quit then. */
  install(version: string): Promise<void> {
    const script = updateScript(process.platform, version);
    const path = join(this.userData, script.name);
    writeFileSync(path, script.text, { mode: 0o755 });
    writeFileSync(this.markerPath, JSON.stringify({ target: version } satisfies Marker));
    const child =
      process.platform === 'win32'
        ? spawn('cmd.exe', cmdArgs(path), { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true })
        : spawn('/bin/sh', [path], { detached: true, stdio: 'ignore' });
    child.unref();
    return new Promise((resolve, reject) => {
      child.once('spawn', () => {
        log.info(`update to ${version} started (${path})`);
        resolve();
      });
      // Nothing was updated: without the marker the next start does not report an npm failure that never happened.
      child.once('error', (error) => {
        log.error('update script did not start', error);
        rmSync(this.markerPath, { force: true });
        reject(error);
      });
    });
  }
}
