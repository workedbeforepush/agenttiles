// Installs and removes AgentTiles's hooks and statusline wrapper in ~/.claude/settings.json.
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
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
import { t } from './i18n';
import type { MessageKey } from '../core/i18n';

type Part = 'hooks' | 'statusline';

export class Integration {
  readonly hookPath: string;
  private readonly chainPath: string;
  private nodePath: string | null = null;
  /** The last failure per part: a later success of the other part must not hide it. */
  private readonly errors = new Map<Part, string>();

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
      throw new Error(t('main.integration.nodeMissing'));
    }
    const path = output.trim();
    if (!path) throw new Error(t('main.integration.nodeMissing'));
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
   * small as possible; the write is atomic (tmp + rename next to the real file) and keeps the file's permissions.
   * Nothing is written when nothing changes.
   */
  private updateSettings(change: (settings: ClaudeSettings) => ClaudeSettings): void {
    const current = this.readSettings();
    const next = change(current);
    if (isDeepStrictEqual(next, current)) return;
    const target = this.settingsTarget();
    mkdirSync(dirname(target), { recursive: true });
    const tmp = `${target}.agenttiles.tmp`;
    const mode = existsSync(target) ? statSync(target).mode & 0o777 : 0o600;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode });
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
        error: this.errors.size > 0 ? [...this.errors.values()].join('\n') : null,
      };
    } catch (error) {
      return { hooksInstalled: false, statuslineInstalled: false, nodePath: null, error: (error as Error).message };
    }
  }

  /** `action` names the step in the log, `failed` is the message the user sees when it fails. */
  private run(part: Part, action: string, failed: MessageKey, fn: () => void): void {
    try {
      fn();
      this.errors.delete(part);
      log.info(`integration: ${action}`);
    } catch (error) {
      this.errors.set(part, t(failed, { error: (error as Error).message }));
      log.error(`integration: ${action} failed`, error);
    }
  }

  setHooks(enabled: boolean, permissionTimeoutSec: number): void {
    const failed = enabled ? 'main.integration.installHooksFailed' : 'main.integration.uninstallHooksFailed';
    this.run('hooks', enabled ? 'install hooks' : 'uninstall hooks', failed, () => {
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
    const failed = enabled ? 'main.integration.installStatuslineFailed' : 'main.integration.uninstallStatuslineFailed';
    this.run('statusline', enabled ? 'install statusline' : 'uninstall statusline', failed, () => {
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
   * Brings existing AgentTiles entries up to date (node path, hook path, permission timeout). Does nothing for parts
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
