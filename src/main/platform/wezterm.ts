// WezTerm command lines and `wezterm cli list` parsing; pure, so tests run on every OS.

/** One pane from `wezterm cli list --format json` (the fields AgentTiles uses). */
export interface WezTermPane {
  paneId: number;
  /** The pane title: Claude Code titles its pane "<spinner> <session title>". */
  title: string;
  /** Title of the GUI window holding the pane, as the window shows it right now. */
  windowTitle: string;
  /** e.g. "/dev/ttys003" or "/dev/pts/3"; null where WezTerm knows none (Windows). */
  tty: string | null;
}

export const WEZTERM_LIST_ARGS = ['cli', 'list', '--format', 'json'];

/** Activates the pane and its tab in its window (the GUI window itself is raised by the caller). */
export function weztermActivateArgs(paneId: number): string[] {
  return ['cli', 'activate-pane', '--pane-id', String(paneId)];
}

export function parseWezTermPanes(json: string): WezTermPane[] {
  const items = JSON.parse(json) as unknown;
  if (!Array.isArray(items)) throw new Error('wezterm cli list did not return a list');
  return items.map((item: Record<string, unknown>) => ({
    paneId: Number(item['pane_id']),
    title: String(item['title'] ?? ''),
    windowTitle: String(item['window_title'] ?? ''),
    tty: typeof item['tty_name'] === 'string' ? item['tty_name'] : null,
  }));
}

/** The rule Windows Terminal tabs are matched by too: the title itself, or the title after a spinner prefix. */
export function titleMatches(name: string, titles: string[]): boolean {
  return titles.some((t) => name === t || name.endsWith(` ${t}`));
}

/** The session's pane: by its terminal where WezTerm reports one, by title otherwise. */
export function findWezTermPane(panes: WezTermPane[], tty: string | null, titles: string[]): WezTermPane | null {
  if (tty) return panes.find((p) => p.tty === tty) ?? null;
  return panes.find((p) => titleMatches(p.title, titles)) ?? null;
}

/** The path of a program installed next to `path` ("C:\\Apps\\WezTerm\\wezterm-gui.exe" → "...\\wezterm.exe"). */
export function siblingExecutable(path: string, name: string): string {
  return /[\\/]/.test(path) ? path.replace(/[^\\/]+$/, name) : name;
}
