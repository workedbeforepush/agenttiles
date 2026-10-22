// Per-session record and the pure state logic that merges registry, transcript and hook events.
import type {
  Activity,
  DiffView,
  GitView,
  HistoryPoint,
  PendingPermission,
  QuestionView,
  SessionState,
  StateLabel,
  TileView,
} from './types';
import { suggestionLabel, suggestionsOf, type PermissionUpdate } from './permissions';
import type { RegistryEntry } from './registry';
import { emptyTranscriptInfo, pushRecent, type TranscriptInfo } from './transcript';
import { clipText, toolSummary } from './tools';
import { projectName } from './paths';

export const HISTORY_WINDOW_MS = 30 * 60 * 1000;

export interface HookState {
  state: SessionState;
  at: number;
  activity: Activity | null;
  label: StateLabel | null;
  /** Survives the registry's later "idle" (turn failures). */
  sticky: boolean;
}

/** Permission summaries are longer than activity lines: the user approves based on them. */
const PENDING_SUMMARY_MAX = 240;

export interface StatuslineInfo {
  model: string | null;
  costUsd: number | null;
  contextPct: number | null;
  linesAdded: number | null;
  linesRemoved: number | null;
  worktree: string | null;
  worktreeBranch: string | null;
  pr: { number: number; url: string | null; reviewState: string | null } | null;
}

export interface PendingEntry extends PendingPermission {
  at: number;
  toolKey: string;
  /** Claude Code's permission suggestions, sent back unchanged for "always allow". */
  suggestions: PermissionUpdate[];
}

export interface SessionRecord {
  sessionId: string;
  cwd: string;
  transcriptPath: string | null;
  registry: RegistryEntry | null;
  transcript: TranscriptInfo;
  hooks: boolean;
  hookState: HookState | null;
  /** The hook state when a compaction started; restored when it ends outside a turn (idle compaction, /compact). */
  beforeCompact: HookState | null;
  /** Running subagents: agent id -> agent type. */
  subagents: Map<string, string>;
  /** Tasks of the session: task id -> subject and completion. */
  tasks: Map<string, { subject: string; done: boolean }>;
  pending: PendingEntry[];
  /** Streamed assistant message, deltas stored by their index so out-of-order delivery is harmless. */
  message: { id: string; parts: string[] } | null;
  hookAssistant: string | null;
  recentTools: string[];
  turnStartedAt: number | null;
  lastTurnMs: number | null;
  statusline: StatuslineInfo | null;
  firstSeen: number;
  view: { state: SessionState; since: number };
  history: HistoryPoint[];
}

export function newRecord(sessionId: string, cwd: string, now: number): SessionRecord {
  return {
    sessionId,
    cwd,
    transcriptPath: null,
    registry: null,
    transcript: emptyTranscriptInfo(),
    hooks: false,
    hookState: null,
    beforeCompact: null,
    subagents: new Map(),
    tasks: new Map(),
    pending: [],
    message: null,
    hookAssistant: null,
    recentTools: [],
    turnStartedAt: null,
    lastTurnMs: null,
    statusline: null,
    firstSeen: now,
    view: { state: 'idle', since: now },
    history: [],
  };
}

export type HookInput = Record<string, unknown>;

function s(input: HookInput, key: string): string | null {
  const value = input[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The start of a streamed message, as much as a preview of `max` characters needs: joining every part of a long reply
 * on each delta would be quadratic. Parts may arrive out of order, so `parts` can have holes.
 */
function messageStart(parts: (string | undefined)[], max: number): string {
  let text = '';
  for (const part of parts) {
    text += part ?? '';
    if (text.trimStart().length > max) break;
  }
  return text;
}

export function toolKey(toolName: string, toolInput: unknown): string {
  return `${toolName}|${JSON.stringify(toolInput ?? null)}`;
}

export interface HookEffects {
  /** Pending permission ids whose hook process must be released with "pass". */
  release: string[];
  ended: boolean;
  configChanged: boolean;
  /** A new user turn started (UserPromptSubmit). */
  turnStarted: boolean;
}

const RELEASE_ALL = new Set(['Stop', 'StopFailure', 'UserPromptSubmit', 'SessionEnd']);
const RELEASE_MATCHING = new Set(['PostToolUse', 'PostToolUseFailure', 'PermissionDenied']);

/**
 * Sets the hook state unless a newer event already did. Hook events arrive from separate processes, so they can be
 * delivered out of order; `at` is the time the hook process started, not the receive time.
 */
function textActivity(text: string | null): Activity | null {
  return text === null ? null : { kind: 'text', text };
}

function setHook(
  rec: SessionRecord,
  at: number,
  state: SessionState,
  activity: Activity | null,
  label: StateLabel | null,
  sticky = false,
): void {
  if (rec.hookState && at < rec.hookState.at) return;
  rec.hookState = { state, at, activity, label, sticky };
}

function endTurn(rec: SessionRecord, at: number): void {
  if (rec.turnStartedAt !== null && rec.turnStartedAt > at) return; // a newer turn already started
  if (rec.turnStartedAt !== null) rec.lastTurnMs = at - rec.turnStartedAt;
  rec.turnStartedAt = null;
}

/** Releases the pending request this tool event belongs to: exact input match, else the only one of that tool. */
function releaseMatching(rec: SessionRecord, input: HookInput): string[] {
  const toolName = s(input, 'tool_name') ?? '';
  const key = toolKey(toolName, input['tool_input']);
  const exact = rec.pending.find((p) => p.toolKey === key);
  const sameTool = rec.pending.filter((p) => p.toolName === toolName);
  const match = exact ?? (sameTool.length === 1 ? sameTool[0] : undefined);
  if (!match) return [];
  rec.pending = rec.pending.filter((p) => p !== match);
  return [match.id];
}

/**
 * Applies one hook event. `now` is the event time (hook process start). PermissionRequest is handled by addPending.
 */
export function applyHookEvent(rec: SessionRecord, input: HookInput, now: number): HookEffects {
  const effects: HookEffects = { release: [], ended: false, configChanged: false, turnStarted: false };
  const event = s(input, 'hook_event_name') ?? '';
  rec.hooks = true;
  const transcriptPath = s(input, 'transcript_path');
  if (transcriptPath) rec.transcriptPath = transcriptPath;

  if (RELEASE_ALL.has(event)) {
    effects.release = rec.pending.map((p) => p.id);
    rec.pending = [];
  } else if (RELEASE_MATCHING.has(event)) {
    effects.release = releaseMatching(rec, input);
  }

  const toolName = s(input, 'tool_name') ?? '';
  switch (event) {
    case 'SessionStart':
      // After a compaction Claude Code starts the session again (source "compact"); PostCompact sets that state.
      if (s(input, 'source') !== 'compact') setHook(rec, now, 'idle', null, null);
      break;
    case 'SessionEnd':
      effects.ended = true;
      break;
    case 'UserPromptSubmit': {
      const prompt = s(input, 'prompt');
      if (prompt) {
        rec.transcript.lastPrompt = clipText(prompt, 400);
        rec.transcript.lastPromptAt = now;
      }
      if (rec.turnStartedAt === null || rec.turnStartedAt < now) rec.turnStartedAt = now;
      effects.turnStarted = true;
      setHook(rec, now, 'working', null, null);
      break;
    }
    case 'PreToolUse': {
      if (toolName === 'AskUserQuestion') {
        setHook(rec, now, 'needsInput', null, 'question');
        break;
      }
      if (toolName === 'ExitPlanMode') {
        setHook(rec, now, 'needsInput', null, 'planReady');
        break;
      }
      const summary = toolSummary(toolName, input['tool_input']);
      rec.recentTools = pushRecent(rec.recentTools, summary);
      setHook(rec, now, 'working', { kind: 'text', text: summary }, null);
      break;
    }
    case 'PostToolUse':
    case 'PermissionDenied':
      setHook(rec, now, 'working', null, null);
      break;
    case 'PostToolUseFailure': {
      // Failed tool calls are routine (a grep without matches); Claude keeps working. Esc interrupts the turn.
      if (input['is_interrupt'] === true) {
        setHook(rec, now, 'idle', null, null);
        break;
      }
      const error = s(input, 'error');
      const detail = error ? `: ${clipText(error, 120)}` : '';
      setHook(rec, now, 'working', { kind: 'failed', text: `${toolSummary(toolName, input['tool_input'])}${detail}` }, null);
      break;
    }
    case 'Notification': {
      const type = s(input, 'notification_type');
      if (type === 'permission_prompt') {
        setHook(rec, now, 'needsApproval', rec.hookState?.activity ?? null, null);
      } else if (type === 'idle_prompt') {
        setHook(rec, now, 'done', null, null);
      } else if (type === 'elicitation_dialog') {
        setHook(rec, now, 'needsInput', textActivity(s(input, 'message')), 'question');
      }
      break;
    }
    case 'Stop': {
      const last = s(input, 'last_assistant_message');
      if (last) rec.hookAssistant = clipText(last, 400);
      rec.message = null;
      endTurn(rec, now);
      setHook(rec, now, 'done', null, null);
      break;
    }
    case 'StopFailure': {
      const error = s(input, 'error') ?? 'unknown';
      const detail = s(input, 'last_assistant_message');
      endTurn(rec, now);
      if (error === 'rate_limit') setHook(rec, now, 'limitHit', textActivity(detail ? clipText(detail, 120) : null), null, true);
      else setHook(rec, now, 'error', textActivity(detail ? clipText(detail, 120) : error), null, true);
      break;
    }
    case 'SubagentStart': {
      const id = s(input, 'agent_id');
      if (id) rec.subagents.set(id, s(input, 'agent_type') ?? 'agent');
      break;
    }
    case 'SubagentStop': {
      const id = s(input, 'agent_id');
      if (id) rec.subagents.delete(id);
      break;
    }
    case 'TaskCreated': {
      const id = s(input, 'task_id');
      if (id && !rec.tasks.has(id)) rec.tasks.set(id, { subject: s(input, 'task_subject') ?? id, done: false });
      break;
    }
    case 'TaskCompleted': {
      const id = s(input, 'task_id');
      if (id) rec.tasks.set(id, { subject: s(input, 'task_subject') ?? rec.tasks.get(id)?.subject ?? id, done: true });
      break;
    }
    case 'PreCompact':
      rec.beforeCompact = rec.hookState?.state === 'compacting' ? rec.beforeCompact : rec.hookState;
      setHook(rec, now, 'compacting', null, null);
      break;
    case 'PostCompact': {
      // Inside a turn Claude carries on; outside one (idle compaction, /compact) the session is where it was before.
      const before = rec.beforeCompact;
      rec.beforeCompact = null;
      if (rec.turnStartedAt !== null) setHook(rec, now, 'working', null, null);
      else if (before) setHook(rec, now, before.state, before.activity, before.label, before.sticky);
      else setHook(rec, now, 'idle', null, null);
      break;
    }
    case 'MessageDisplay': {
      const id = s(input, 'message_id') ?? '';
      const delta = typeof input['delta'] === 'string' ? input['delta'] : '';
      const index = typeof input['index'] === 'number' && Number.isInteger(input['index']) ? input['index'] : null;
      if (rec.message === null || rec.message.id !== id) rec.message = { id, parts: [] };
      if (index !== null && index >= 0 && index < 10_000) rec.message.parts[index] = delta;
      else rec.message.parts.push(delta);
      rec.hookAssistant = clipText(messageStart(rec.message.parts, 400), 400);
      break;
    }
    case 'ConfigChange':
      effects.configChanged = true;
      break;
    default:
      break;
  }
  return effects;
}

/** Adds a held permission request. `diff` is the change of a file tool, computed by the caller (it reads files). */
export function addPending(rec: SessionRecord, id: string, input: HookInput, now: number, diff: DiffView | null = null): void {
  rec.hooks = true;
  const transcriptPath = s(input, 'transcript_path');
  if (transcriptPath) rec.transcriptPath = transcriptPath;
  const toolName = s(input, 'tool_name') ?? 'tool';
  const toolInput = input['tool_input'] ?? null;
  const suggestions = suggestionsOf(input);
  const plan = (toolInput as { plan?: unknown } | null)?.plan;
  rec.pending.push({
    id,
    toolName,
    toolInput,
    questions: toolName === 'AskUserQuestion' ? questionsOf(toolInput) : null,
    diff,
    plan: toolName === 'ExitPlanMode' && typeof plan === 'string' ? plan : null,
    alwaysLabel: suggestionLabel(suggestions),
    suggestions,
    summary: toolSummary(toolName, toolInput, PENDING_SUMMARY_MAX),
    at: now,
    toolKey: toolKey(toolName, toolInput),
  });
}

/** The questions of an AskUserQuestion tool input; empty when the input has an unexpected shape. */
export function questionsOf(toolInput: unknown): QuestionView[] {
  const raw = (toolInput as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(raw)) return [];
  const result: QuestionView[] = [];
  for (const q of raw) {
    if (!q || typeof q !== 'object') return [];
    const item = q as Record<string, unknown>;
    if (typeof item['question'] !== 'string' || !Array.isArray(item['options'])) return [];
    result.push({
      question: item['question'],
      header: typeof item['header'] === 'string' ? item['header'] : '',
      multiSelect: item['multiSelect'] === true,
      options: (item['options'] as unknown[]).flatMap((o) => {
        const option = o as Record<string, unknown> | null;
        return option && typeof option['label'] === 'string'
          ? [{ label: option['label'], description: typeof option['description'] === 'string' ? option['description'] : '' }]
          : [];
      }),
    });
  }
  return result;
}

/**
 * The updated tool input that answers an AskUserQuestion request: the original input plus `answers` (question text
 * -> chosen label, multi-select labels joined with ", ", or free text). Null unless every question has a non-empty
 * answer and nothing else is answered.
 */
export function questionAnswerInput(
  toolName: string,
  toolInput: unknown,
  answers: Record<string, string>,
): Record<string, unknown> | null {
  if (toolName !== 'AskUserQuestion' || !toolInput || typeof toolInput !== 'object') return null;
  const questions = questionsOf(toolInput);
  if (questions.length === 0) return null;
  const keys = Object.keys(answers);
  if (keys.length !== questions.length) return null;
  for (const q of questions) {
    const value = answers[q.question];
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 2000) return null;
  }
  return { ...(toolInput as Record<string, unknown>), answers: { ...answers } };
}

export function removePending(rec: SessionRecord, id: string): boolean {
  const before = rec.pending.length;
  rec.pending = rec.pending.filter((p) => p.id !== id);
  return rec.pending.length !== before;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function applyStatusline(rec: SessionRecord, payload: HookInput): void {
  const model = obj(payload['model']);
  const cost = obj(payload['cost']);
  const context = obj(payload['context_window']);
  const workspace = obj(payload['workspace']);
  const worktree = obj(payload['worktree']);
  const pr = obj(payload['pr']);
  const prNumber = num(pr?.['number']);
  rec.statusline = {
    model: str(model?.['display_name']),
    costUsd: num(cost?.['total_cost_usd']),
    contextPct: num(context?.['used_percentage']),
    linesAdded: num(cost?.['total_lines_added']),
    linesRemoved: num(cost?.['total_lines_removed']),
    worktree: str(worktree?.['name']) ?? str(workspace?.['git_worktree']),
    worktreeBranch: str(worktree?.['branch']),
    pr: prNumber === null ? null : { number: prNumber, url: str(pr?.['url']), reviewState: str(pr?.['review_state']) },
  };
}

export interface Derived {
  state: SessionState;
  at: number;
  activity: Activity | null;
  label: StateLabel | null;
}

function fromRegistry(rec: SessionRecord, reg: RegistryEntry): Derived {
  const at = reg.statusUpdatedAt;
  const t = rec.transcript;
  const hook = rec.hookState;
  switch (reg.status) {
    case 'busy':
      return { state: 'working', at, activity: null, label: null };
    case 'waiting': {
      if (reg.waitingFor === 'permission prompt') {
        return { state: 'needsApproval', at, activity: hook?.activity ?? null, label: null };
      }
      if (hook && (hook.state === 'needsApproval' || hook.state === 'needsInput')) {
        return { state: hook.state, at, activity: hook.activity, label: hook.label };
      }
      return { state: 'needsInput', at, activity: null, label: null };
    }
    case 'idle': {
      // A failed turn must not be overwritten by the registry's later "idle": the failure is the interesting part.
      if (hook?.sticky) return { state: hook.state, at, activity: hook.activity, label: hook.label };
      const done = hook?.state === 'done' || t.lastAssistantAt > t.lastPromptAt;
      return { state: done ? 'done' : 'idle', at, activity: null, label: null };
    }
    case 'shell':
      return { state: 'shell', at, activity: null, label: null };
    default:
      return { state: 'unknown', at, activity: null, label: null };
  }
}

/** Pending permissions win. Otherwise the newest source wins; on a tie the hook event wins. */
export function deriveState(rec: SessionRecord): Derived {
  const first = rec.pending[0];
  if (first?.toolName === 'AskUserQuestion') {
    const question = questionsOf(first.toolInput)[0]?.question ?? null;
    return { state: 'needsInput', at: first.at, activity: textActivity(question), label: 'question' };
  }
  if (first?.plan !== null && first?.plan !== undefined) {
    return { state: 'needsInput', at: first.at, activity: { kind: 'planReady' }, label: 'planReady' };
  }
  if (first) return { state: 'needsApproval', at: first.at, activity: textActivity(first.summary), label: null };
  const hook = rec.hookState;
  const reg = rec.registry ? fromRegistry(rec, rec.registry) : null;
  if (hook && (!reg || hook.at >= reg.at)) {
    return { state: hook.state, at: hook.at, activity: hook.activity, label: hook.label };
  }
  if (reg) return reg;
  return { state: 'idle', at: rec.firstSeen, activity: null, label: null };
}

/**
 * Recomputes the derived view state and records it in the 30 minute history. Keeps `since` while the state is
 * unchanged. Returns the previous state and its duration when the state changed.
 */
export function refreshView(rec: SessionRecord, now: number): { from: SessionState; durationMs: number } | null {
  const derived = deriveState(rec);
  const cutoff = now - HISTORY_WINDOW_MS;
  while (rec.history.length > 1 && (rec.history[1]?.at ?? now) <= cutoff) rec.history.shift();
  if (rec.history.length > 0 && derived.state === rec.view.state) return null;
  const previous = { from: rec.view.state, durationMs: now - rec.view.since };
  const isFirst = rec.history.length === 0;
  rec.view = { state: derived.state, since: now };
  rec.history.push({ state: derived.state, at: now });
  return isFirst ? null : previous;
}

export interface TileOverrides {
  rename: string | null;
  pinned: boolean;
  /** Branch read from the working directory's .git/HEAD; the most current source. */
  branch: string | null;
}

/** Name priority: AgentTiles rename > user-set Claude name > ai-title > derived name. */
export function tileName(rec: SessionRecord, rename: string | null): string {
  if (rename) return rename;
  const reg = rec.registry;
  if (reg?.name && reg.nameSource && reg.nameSource !== 'derived') return reg.name;
  if (rec.transcript.aiTitle) return rec.transcript.aiTitle;
  return reg?.name ?? projectName(rec.cwd);
}

function gitView(rec: SessionRecord, branch: string | null): GitView {
  const sl = rec.statusline;
  return {
    // The transcript's gitBranch goes stale and says "HEAD" when Claude Code could not tell; it is the last resort.
    branch: branch ?? sl?.worktreeBranch ?? (rec.transcript.gitBranch === 'HEAD' ? null : rec.transcript.gitBranch),
    worktree: sl?.worktree ?? null,
    pr: sl?.pr ?? null,
    linesAdded: sl?.linesAdded ?? null,
    linesRemoved: sl?.linesRemoved ?? null,
  };
}

export function toTile(rec: SessionRecord, overrides: TileOverrides): TileView {
  const derived = deriveState(rec);
  const t = rec.transcript;
  let activity = derived.activity;
  if (activity === null && derived.state === 'working') {
    const tool = rec.hooks ? null : t.activeTool;
    activity = tool ? { kind: 'text', text: tool } : { kind: 'thinking' };
  }
  const tasks = [...rec.tasks.values()];
  const first = rec.pending[0];
  const working = derived.state === 'working' || derived.state === 'compacting' || derived.state === 'needsApproval';
  const hooklessTurnStart = working && t.lastPromptAt > 0 ? t.lastPromptAt : null;
  const hooklessLastTurn = t.lastAssistantAt > t.lastPromptAt && t.lastPromptAt > 0 ? t.lastAssistantAt - t.lastPromptAt : null;
  return {
    sessionId: rec.sessionId,
    pid: rec.registry?.pid ?? 0,
    cwd: rec.cwd,
    project: projectName(rec.cwd),
    name: tileName(rec, overrides.rename),
    state: derived.state,
    label: derived.label ?? derived.state,
    stateSince: rec.view.since,
    activity,
    model: rec.statusline?.model ?? t.model,
    subagents: rec.subagents.size,
    tasksDone: tasks.filter((task) => task.done).length,
    tasksTotal: tasks.length,
    costUsd: rec.statusline?.costUsd ?? null,
    contextPct: rec.statusline?.contextPct ?? null,
    hooks: rec.hooks || t.ourHooks,
    pinned: overrides.pinned,
    startedAt: rec.registry?.startedAt ?? rec.firstSeen,
    lastPrompt: t.lastPrompt,
    lastAssistant: rec.hookAssistant ?? t.lastAssistant,
    pending: first
      ? {
          id: first.id,
          toolName: first.toolName,
          summary: first.summary,
          toolInput: first.toolInput,
          questions: first.questions,
          diff: first.diff,
          plan: first.plan,
          alwaysLabel: first.alwaysLabel,
        }
      : null,
    version: rec.registry?.version ?? null,
    jobId: rec.registry?.jobId ?? null,
    recentTools: rec.hooks ? rec.recentTools : t.recentTools,
    turnStartedAt: rec.hooks ? rec.turnStartedAt : hooklessTurnStart,
    lastTurnMs: rec.hooks ? rec.lastTurnMs : hooklessLastTurn,
    history: rec.history.map((point) => ({ ...point })),
    git: gitView(rec, overrides.branch),
    tasks,
    subagentTypes: [...rec.subagents.values()],
  };
}
