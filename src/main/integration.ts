// Installs and removes ccdash's hooks and statusline wrapper in ~/.claude/settings.json.
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { IntegrationStatus } from '../core/types';
import { userSettingsPath } from '../core/paths';
import {
  HOOK_SCRIPT_NAME,
  anyHooksInstalled,
  currentStatusline,
  hooksInstalled,
  installHooks,
  installStatusline,
  statuslineCommand,
  statuslineInstalled,
  uninstallHooks,
  uninstallStatusline,
  type ClaudeSettings,
  type StatusLineConfig,
} from '../core/hookConfig';
import { log } from './log';

const NODE_MISSING = 'Node.js was not found in PATH. ccdash hooks need Node.js installed.';

export class Integration {
  readonly hookPath: string;
  private readonly chainPath: string;
  private nodePath: string | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly userDataDir: string,
    private readonly bundledHook: string,
  ) {
    this.hookPath = join(userDataDir, HOOK_SCRIPT_NAME);
    this.chainPath = join(userDataDir, 'statusline-chain.json');
  }

  /**
   * The real node executable behind `node` in PATH. Asking node itself resolves version-manager shims
   * (fnm, nvm-windows, volta) to a stable binary path.
   */
  private resolveNode(): string {
    if (this.nodePath) return this.nodePath;
    let output: string;
    try {
      output = execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    } catch {
      throw new Error(NODE_MISSING);
    }
    const path = output.trim();
    if (!path) throw new Error(NODE_MISSING);
    this.nodePath = path;
    return path;
  }

  /** The file to write: the symlink target when settings.json is a symlink (dotfile managers). */
  private settingsTarget(): string {
    const path = userSettingsPath();
    return existsSync(path) ? realpathSync(path) : path;
  }

  private readSettings(): ClaudeSettings {
    const path = userSettingsPath();
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, 'utf8')) as ClaudeSettings;
  }

  /**
   * Read, change and write in one synchronous step to keep the window for concurrent writes by Claude Code as
   * small as possible; the write is atomic (tmp + rename next to the real file).
   */
  private updateSettings(change: (settings: ClaudeSettings) => ClaudeSettings): void {
    const next = change(this.readSettings());
    const target = this.settingsTarget();
    mkdirSync(dirname(target), { recursive: true });
    const tmp = `${target}.ccdash.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    renameSync(tmp, target);
  }

  /** Copies the bundled hook script next to the config so the registered path survives app moves and updates. */
  syncHookScript(): void {
    const current = existsSync(this.hookPath) ? readFileSync(this.hookPath) : null;
    const bundled = readFileSync(this.bundledHook);
    if (current && current.equals(bundled)) return;
    copyFileSync(this.bundledHook, this.hookPath);
    log.info(`hook script updated at ${this.hookPath}`);
  }

  status(permissionTimeoutSec: number): IntegrationStatus {
    try {
      const settings = this.readSettings();
      const ours = anyHooksInstalled(settings) || statuslineInstalled(settings);
      const nodePath = this.nodePath ?? (ours ? this.resolveNode() : null);
      const expectedStatusline = nodePath ? statuslineCommand(nodePath, this.hookPath) : null;
      return {
        hooksInstalled:
          nodePath !== null && hooksInstalled(settings, { nodePath, hookPath: this.hookPath, permissionTimeoutSec }),
        statuslineInstalled: currentStatusline(settings)?.command === expectedStatusline,
        nodePath,
        error: this.lastError,
      };
    } catch (error) {
      return { hooksInstalled: false, statuslineInstalled: false, nodePath: null, error: (error as Error).message };
    }
  }

  private run(action: string, fn: () => void): void {
    try {
      fn();
      this.lastError = null;
      log.info(`integration: ${action}`);
    } catch (error) {
      this.lastError = `${action} failed: ${(error as Error).message}`;
      log.error(`integration: ${action} failed`, error);
    }
  }

  setHooks(enabled: boolean, permissionTimeoutSec: number): void {
    this.run(enabled ? 'install hooks' : 'uninstall hooks', () => {
      if (!enabled) {
        this.updateSettings(uninstallHooks);
        return;
      }
      const nodePath = this.resolveNode();
      this.syncHookScript();
      this.updateSettings((settings) => installHooks(settings, { nodePath, hookPath: this.hookPath, permissionTimeoutSec }));
    });
  }

  setStatusline(enabled: boolean): void {
    this.run(enabled ? 'install statusline' : 'uninstall statusline', () => {
      if (!enabled) {
        const previous = existsSync(this.chainPath)
          ? (JSON.parse(readFileSync(this.chainPath, 'utf8')) as StatusLineConfig)
          : null;
        this.updateSettings((settings) => uninstallStatusline(settings, previous));
        rmSync(this.chainPath, { force: true });
        return;
      }
      const nodePath = this.resolveNode();
      this.syncHookScript();
      this.updateSettings((settings) => {
        // Already ours (possibly with an outdated path): rewrite the command, keep the stored chain.
        const wasOurs = statuslineInstalled(settings);
        const result = installStatusline(settings, nodePath, this.hookPath);
        if (!wasOurs) {
          if (result.previous) writeFileSync(this.chainPath, JSON.stringify(result.previous));
          else rmSync(this.chainPath, { force: true });
        }
        return result.settings;
      });
    });
  }

  /**
   * Brings existing ccdash entries up to date (node path, hook path, permission timeout). Does nothing for parts
   * that are not installed.
   */
  repair(permissionTimeoutSec: number): void {
    let settings: ClaudeSettings;
    try {
      settings = this.readSettings();
    } catch (error) {
      log.warn(`settings.json unreadable, no repair: ${(error as Error).message}`);
      return;
    }
    const status = this.status(permissionTimeoutSec);
    if (anyHooksInstalled(settings) && !status.hooksInstalled) this.setHooks(true, permissionTimeoutSec);
    if (statuslineInstalled(settings) && !status.statuslineInstalled) this.setStatusline(true);
    if (anyHooksInstalled(settings) || statuslineInstalled(settings)) this.syncHookScript();
  }
}
