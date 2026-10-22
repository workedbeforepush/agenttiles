// kitty remote control command lines and environment parsing; pure, so tests run on every OS.

/**
 * The value of one variable in a process environment: Linux's /proc/<pid>/environ (NUL-separated) or macOS's
 * `ps -E -ww -o command=` (the command line, then the variables separated by spaces; a value with a space is cut).
 */
export function environmentValue(environment: string, name: string): string | null {
  for (const entry of environment.split(/[\0\s]/)) {
    if (entry.startsWith(`${name}=`)) return entry.slice(name.length + 1) || null;
  }
  return null;
}

/**
 * `kitty @` arguments that focus the kitty window running `pid` (the process kitty started in it), switching to its
 * tab and OS window. `address` is the remote control socket kitty puts into KITTY_LISTEN_ON.
 */
export function kittyFocusArgs(address: string, pid: number): string[] {
  return ['@', '--to', address, 'focus-window', '--match', `pid:${pid}`];
}
