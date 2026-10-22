// tmux command lines and output parsing; pure, so tests run on every OS.

export interface TmuxPane {
  tty: string;
  /** e.g. "%3": as a switch-client target it changes session, window and pane at once. */
  paneId: string;
  session: string;
}

export interface TmuxClient {
  tty: string;
  pid: number;
  /** Time of the client's last activity, in seconds. */
  activity: number;
  session: string;
}

// Fields separated by spaces, the session name (which can contain spaces) last: tmux prints a tab in a format as "_".
export const TMUX_PANES_ARGS = ['list-panes', '-a', '-F', '#{pane_tty} #{pane_id} #{session_name}'];
export const TMUX_CLIENTS_ARGS = ['list-clients', '-F', '#{client_tty} #{client_pid} #{client_activity} #{client_session}'];

/** Shows the pane in the client: its session, its window and the pane itself. */
export function tmuxSwitchArgs(client: TmuxClient, pane: TmuxPane): string[] {
  return ['switch-client', '-c', client.tty, '-t', pane.paneId];
}

/** The lines of `output` cut into `count` fields; the last field keeps its spaces. */
function fields(output: string, count: number): string[][] {
  return output
    .split('\n')
    .map((line) => line.split(' '))
    .filter((parts) => parts.length >= count)
    .map((parts) => [...parts.slice(0, count - 1), parts.slice(count - 1).join(' ')]);
}

export function parseTmuxPanes(output: string): TmuxPane[] {
  return fields(output, 3).map(([tty, paneId, session]) => ({ tty: tty!, paneId: paneId!, session: session! }));
}

export function parseTmuxClients(output: string): TmuxClient[] {
  return fields(output, 4).map(([tty, pid, activity, session]) => ({
    tty: tty!,
    pid: Number(pid),
    activity: Number(activity),
    session: session!,
  }));
}

/** The client to show the pane in: the most recently used one on the pane's session, else the most recent one. */
export function pickTmuxClient(clients: TmuxClient[], pane: TmuxPane): TmuxClient | null {
  const recent = [...clients].sort((a, b) => b.activity - a.activity);
  return recent.find((c) => c.session === pane.session) ?? recent[0] ?? null;
}
