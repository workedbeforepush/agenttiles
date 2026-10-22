// Win32 helpers via koffi: process table, process start time, host window lookup and focus.
import koffi from 'koffi';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';

const kernel32 = koffi.load('kernel32.dll');
const user32 = koffi.load('user32.dll');
const dwmapi = koffi.load('dwmapi.dll');

const HANDLE = koffi.pointer('HANDLE', koffi.opaque());
koffi.alias('HWND', HANDLE);

const FILETIME = koffi.struct('FILETIME', { low: 'uint32', high: 'uint32' });
const PROCESSENTRY32W = koffi.struct('PROCESSENTRY32W', {
  dwSize: 'uint32',
  cntUsage: 'uint32',
  th32ProcessID: 'uint32',
  th32DefaultHeapID: 'uintptr_t',
  th32ModuleID: 'uint32',
  cntThreads: 'uint32',
  th32ParentProcessID: 'uint32',
  pcPriClassBase: 'int32',
  dwFlags: 'uint32',
  szExeFile: koffi.array('char16_t', 260, 'String'),
});

const OpenProcess = kernel32.func('HANDLE __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(HANDLE h)');
const GetProcessTimes = kernel32.func(
  'bool __stdcall GetProcessTimes(HANDLE h, _Out_ FILETIME *creation, _Out_ FILETIME *exit, _Out_ FILETIME *kernel, _Out_ FILETIME *user)',
);
const GetExitCodeProcess = kernel32.func('bool __stdcall GetExitCodeProcess(HANDLE h, _Out_ uint32 *code)');
const CreateToolhelp32Snapshot =kernel32.func('HANDLE __stdcall CreateToolhelp32Snapshot(uint32 flags, uint32 pid)');
const Process32FirstW = kernel32.func('bool __stdcall Process32FirstW(HANDLE snap, _Inout_ PROCESSENTRY32W *entry)');
const Process32NextW = kernel32.func('bool __stdcall Process32NextW(HANDLE snap, _Inout_ PROCESSENTRY32W *entry)');
const GetCurrentThreadId = kernel32.func('uint32 __stdcall GetCurrentThreadId()');
const AttachConsole = kernel32.func('bool __stdcall AttachConsole(uint32 pid)');
const FreeConsole = kernel32.func('bool __stdcall FreeConsole()');
const GetConsoleWindow = kernel32.func('HWND __stdcall GetConsoleWindow()');

const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(HWND hwnd, intptr_t lParam)');
const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)');
const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(HWND hwnd, _Out_ uint32 *pid)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(HWND hwnd)');
const IsIconic = user32.func('bool __stdcall IsIconic(HWND hwnd)');
const GetWindow = user32.func('HWND __stdcall GetWindow(HWND hwnd, uint32 cmd)');
const GetWindowTextLengthW = user32.func('int __stdcall GetWindowTextLengthW(HWND hwnd)');
const ShowWindow = user32.func('bool __stdcall ShowWindow(HWND hwnd, int cmd)');
const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(HWND hwnd)');
const BringWindowToTop = user32.func('bool __stdcall BringWindowToTop(HWND hwnd)');
const GetForegroundWindow = user32.func('HWND __stdcall GetForegroundWindow()');
const AttachThreadInput = user32.func('bool __stdcall AttachThreadInput(uint32 a, uint32 b, bool attach)');
const MonitorFromWindow = user32.func('HANDLE __stdcall MonitorFromWindow(HWND hwnd, uint32 flags)');
const GetWindowLongW = user32.func('int32 __stdcall GetWindowLongW(HWND hwnd, int index)');
const DwmGetWindowAttribute = dwmapi.func(
  'int32 __stdcall DwmGetWindowAttribute(HWND hwnd, uint32 attribute, _Out_ uint32 *value, uint32 size)',
);

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const TH32CS_SNAPPROCESS = 0x2;
const GW_OWNER = 4;
const SW_RESTORE = 9;
const SW_MINIMIZE = 6;
const MONITOR_DEFAULTTONEAREST = 2;
const GWL_EXSTYLE = -20;
const WS_EX_TOPMOST = 0x8;
const WS_EX_TOOLWINDOW = 0x80;
const DWMWA_CLOAKED = 14;

/**
 * Windows that count for "what the user sees on top": visible, not cloaked by DWM (hidden UWP windows such as
 * TextInputHost report IsWindowVisible), not always-on-top overlays and not tool windows.
 */
function isRegularWindow(hwnd: Hwnd): boolean {
  if (!IsWindowVisible(hwnd) || IsIconic(hwnd) || GetWindow(hwnd, GW_OWNER)) return false;
  if (GetWindowTextLengthW(hwnd) === 0) return false;
  const exStyle = GetWindowLongW(hwnd, GWL_EXSTYLE);
  if (exStyle & (WS_EX_TOPMOST | WS_EX_TOOLWINDOW)) return false;
  const cloaked = [0];
  return DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4) !== 0 || cloaked[0] === 0;
}
const INVALID_HANDLE = -1n;
const STILL_ACTIVE = 259;
const TAB_SELECT_TIMEOUT_MS = 10_000;

type Hwnd = unknown;

interface ProcessInfo {
  pid: number;
  ppid: number;
  exe: string;
}

/**
 * Creation time of a running process as a FILETIME decimal string (the format of procStart in the registry), or null
 * when the process does not exist or has exited (an exited process lives on while another process holds a handle).
 */
export function processStartTime(pid: number): string | null {
  const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (!handle) return null;
  try {
    const exitCode = [0];
    if (!GetExitCodeProcess(handle, exitCode) || exitCode[0] !== STILL_ACTIVE) return null;
    const creation: { low?: number; high?: number } = {};
    if (!GetProcessTimes(handle, creation, {}, {}, {})) return null;
    const value = (BigInt(creation.high ?? 0) << 32n) | BigInt(creation.low ?? 0);
    return value.toString();
  } finally {
    CloseHandle(handle);
  }
}

export function processTable(): Map<number, ProcessInfo> {
  const table = new Map<number, ProcessInfo>();
  const snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (!snap || koffi.address(snap) === BigInt.asUintN(64, INVALID_HANDLE)) return table;
  try {
    const entry: Record<string, unknown> = { dwSize: koffi.sizeof(PROCESSENTRY32W) };
    let ok = Process32FirstW(snap, entry);
    while (ok) {
      const pid = entry['th32ProcessID'] as number;
      table.set(pid, { pid, ppid: entry['th32ParentProcessID'] as number, exe: String(entry['szExeFile']) });
      ok = Process32NextW(snap, entry);
    }
  } finally {
    CloseHandle(snap);
  }
  return table;
}

export function claudeProcessIds(): number[] {
  return [...processTable().values()].filter((p) => p.exe.toLowerCase() === 'claude.exe').map((p) => p.pid);
}

/** The process and its ancestors, nearest first. Stops at cycles and missing parents. */
export function ancestry(pid: number, table: Map<number, ProcessInfo>): ProcessInfo[] {
  const chain: ProcessInfo[] = [];
  const seen = new Set<number>();
  let current = table.get(pid);
  while (current && !seen.has(current.pid)) {
    chain.push(current);
    seen.add(current.pid);
    current = table.get(current.ppid);
  }
  return chain;
}

/** Visible, unowned, titled top-level windows grouped by owning process id. */
function topLevelWindows(): Map<number, Hwnd[]> {
  const byPid = new Map<number, Hwnd[]>();
  EnumWindows((hwnd: Hwnd) => {
    if (!IsWindowVisible(hwnd) || GetWindow(hwnd, GW_OWNER) || GetWindowTextLengthW(hwnd) === 0) return true;
    const out = [0];
    GetWindowThreadProcessId(hwnd, out);
    const pid = out[0] ?? 0;
    const list = byPid.get(pid) ?? [];
    list.push(hwnd);
    byPid.set(pid, list);
    return true;
  }, 0);
  return byPid;
}

function consoleWindowOf(pid: number): Hwnd | null {
  if (!AttachConsole(pid)) return null;
  try {
    const hwnd = GetConsoleWindow();
    return hwnd && IsWindowVisible(hwnd) ? hwnd : null;
  } finally {
    FreeConsole();
  }
}

export interface HostWindows {
  /** All top-level windows of the hosting process, most recently active first. One process can own several. */
  hwnds: Hwnd[];
  exe: string;
}

/**
 * Finds the windows of the process hosting a Claude Code process: the nearest ancestor that owns top-level windows
 * (Windows Terminal, IDEs), otherwise the classic console window attached to the process.
 */
export function findHostWindows(pid: number): HostWindows | null {
  const table = processTable();
  const windows = topLevelWindows();
  for (const proc of ancestry(pid, table)) {
    const hwnds = windows.get(proc.pid);
    if (hwnds && hwnds.length > 0) return { hwnds, exe: proc.exe };
  }
  const console = consoleWindowOf(pid);
  return console ? { hwnds: [console], exe: 'conhost.exe' } : null;
}

export function bringToFront(hwnd: Hwnd): void {
  if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
  const out = [0];
  const foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out);
  const ownThread = GetCurrentThreadId();
  const attached = foregroundThread !== ownThread && AttachThreadInput(ownThread, foregroundThread, true);
  try {
    SetForegroundWindow(hwnd);
    BringWindowToTop(hwnd);
  } finally {
    if (attached) AttachThreadInput(ownThread, foregroundThread, false);
  }
}

/**
 * Registers the app id for the current user so toasts show the app name and icon instead of "electron". This is the
 * registration unpackaged desktop apps use (HKCU\\Software\\Classes\\AppUserModelId); no admin rights needed.
 */
export function registerAppId(appId: string, displayName: string, iconPath: string): void {
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${appId}`;
  const set = (name: string, value: string): void => {
    execFileSync('reg.exe', ['add', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true, stdio: 'ignore' });
  };
  set('DisplayName', displayName);
  set('IconUri', iconPath);
}

export function minimize(hwnd: Hwnd): void {
  ShowWindow(hwnd, SW_MINIMIZE);
}

/**
 * True when the window is not minimized and no other visible top-level window lies above it on its monitor, ignoring
 * windows of `ignorePid` (AgentTiles itself, which takes the focus when its tile is clicked).
 */
export function isFrontmost(hwnd: Hwnd, ignorePid: number): boolean {
  if (IsIconic(hwnd) || !IsWindowVisible(hwnd)) return false;
  const target = koffi.address(hwnd);
  const monitor = koffi.address(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST));
  let result = false;
  // EnumWindows walks the top-level windows in z-order, topmost first.
  EnumWindows((candidate: Hwnd) => {
    if (!isRegularWindow(candidate)) return true;
    const out = [0];
    GetWindowThreadProcessId(candidate, out);
    if (out[0] === ignorePid) return true;
    if (koffi.address(MonitorFromWindow(candidate, MONITOR_DEFAULTTONEAREST)) !== monitor) return true;
    result = koffi.address(candidate) === target;
    return false; // the first relevant window decides
  }, 0);
  return result;
}

export function hwndValue(hwnd: Hwnd): string {
  return koffi.address(hwnd).toString();
}

// Runs for the app's lifetime: starting PowerShell and loading UI Automation takes about a second, the tab search
// itself a few milliseconds. One request per stdin line ({"hwnds": [...], "titles": [...]}), one answer per stdout
// line: the hwnd whose tab was selected, or an empty line. Ends when stdin closes.
const SELECT_TAB_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $answer = ''
  try {
    $request = $line | ConvertFrom-Json
    :search foreach ($h in $request.hwnds) {
      $window = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$h)
      foreach ($tab in $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)) {
        $name = $tab.Current.Name
        foreach ($t in $request.titles) {
          if ($name -eq $t -or $name.EndsWith(' ' + $t)) {
            $tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
            $answer = $h
            break search
          }
        }
      }
    }
  } catch {
    # A window that closed meanwhile: no tab.
  }
  [Console]::Out.WriteLine($answer)
  [Console]::Out.Flush()
}
`;

/**
 * Opens a new Windows Terminal tab in `cwd` running `command` (in the most recently used window, or a new one).
 * Resolves false when wt.exe could not be started.
 */
export function openTerminalTab(cwd: string, command: string[], env: NodeJS.ProcessEnv): Promise<boolean> {
  // wt.exe splits its command line at ';' (subcommand separator) unless it is escaped.
  // Escape backslashes first so existing escapes cannot alter semicolon escaping.
  const escape = (arg: string): string => arg.replace(/\\/g, '\\\\').replace(/;/g, '\\;');
  return new Promise((resolve) => {
    const child = spawn('wt.exe', ['-w', '0', 'new-tab', '-d', escape(cwd), ...command.map(escape)], {
      env,
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => resolve(false));
    child.on('spawn', () => {
      child.unref();
      resolve(true);
    });
  });
}

let tabWorker: ChildProcess | null = null;
let tabAnswer: ((line: string | null) => void) | null = null;

function startTabWorker(): ChildProcess {
  const encoded = Buffer.from(SELECT_TAB_SCRIPT, 'utf16le').toString('base64');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  let buffered = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    buffered += chunk.toString();
    let end: number;
    while ((end = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, end).trim();
      buffered = buffered.slice(end + 1);
      tabAnswer?.(line);
    }
  });
  const gone = (): void => {
    if (tabWorker === child) tabWorker = null;
    tabAnswer?.(null);
  };
  child.on('error', gone);
  child.on('exit', gone);
  // Writing to a worker that just exited fails with EPIPE; `exit` already answered.
  child.stdin?.on('error', () => undefined);
  return child;
}

/** Starts the tab worker ahead of the first click, so that click does not wait for PowerShell. */
export function prepareTabSelection(): void {
  tabWorker ??= startTabWorker();
}

/**
 * Finds the Windows Terminal window and tab whose title matches one of the given titles (Claude Code titles its tab
 * "<spinner> <session title>"), selects that tab and resolves the window. Resolves null when no tab matched.
 * One request at a time (the caller serialises).
 */
export function selectTerminalTab(hwnds: Hwnd[], titles: string[]): Promise<Hwnd | null> {
  const values = hwnds.map(hwndValue);
  const worker = (tabWorker ??= startTabWorker());
  return new Promise((resolve) => {
    // UI Automation can hang on an unresponsive window: drop the worker, the next request starts a new one.
    const timer = setTimeout(() => worker.kill(), TAB_SELECT_TIMEOUT_MS);
    tabAnswer = (line) => {
      clearTimeout(timer);
      tabAnswer = null;
      const index = line ? values.indexOf(line) : -1;
      resolve(index >= 0 ? (hwnds[index] ?? null) : null);
    };
    worker.stdin?.write(`${JSON.stringify({ hwnds: values, titles })}\n`);
  });
}
