<script lang="ts">
  import { onMount } from 'svelte';
  import type { TileAction, TileView } from '../../../core/types';
  import { markdownHtml } from '../markdown';
  import DiffLines from './DiffLines.svelte';
  import { TINTED, duration, plainText, prettyInput, since, stateColor, usd } from '../format';
  import { t } from '../i18n.svelte';
  import { activityText, stateText } from '../../../core/i18n/view';


  interface Props {
    tile: TileView;
    now: number;
    index: number;
    selected: boolean;
    variant: 'card' | 'row';
    fiveHourResetsAt: number | null;
    /** Context percentage that marks a tile; 0 = never. */
    contextWarnPct: number;
    onDragStart: (sessionId: string) => void;
    onDropOn: (sessionId: string) => void;
    onAnswer: (sessionId: string) => void;
  }

  let { tile, now, index, selected, variant, fiveHourResetsAt, contextWarnPct, onDragStart, onDropOn, onAnswer }: Props = $props();

  const HISTORY_MS = 30 * 60 * 1000;

  let menu = $state<{ x: number; y: number } | null>(null);
  let renaming = $state(false);
  let renameValue = $state('');
  let hover = $state(false);
  let dragOver = $state(false);
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;

  function act(action: TileAction): void {
    menu = null;
    void window.agenttiles.tileAction(tile.sessionId, action);
  }

  function openMenu(event: MouseEvent): void {
    event.preventDefault();
    hover = false;
    menu = {
      x: Math.max(0, Math.min(event.clientX, window.innerWidth - 180)),
      y: Math.max(0, Math.min(event.clientY, window.innerHeight - 250)),
    };
  }

  function startRename(): void {
    menu = null;
    renameValue = tile.name;
    renaming = true;
  }

  function commitRename(): void {
    // The input blurs as it goes away after Enter or Escape; that blur must neither save twice nor undo a cancel.
    if (!renaming) return;
    renaming = false;
    const value = renameValue.trim();
    if (value === tile.name) return;
    void window.agenttiles.renameTile(tile.sessionId, value.length > 0 ? value : null);
  }

  function onRenameKey(event: KeyboardEvent): void {
    event.stopPropagation();
    // While an IME composes, Enter and Escape belong to the composition.
    if (event.isComposing) return;
    if (event.key === 'Enter') commitRename();
    if (event.key === 'Escape') renaming = false;
  }

  /** Answers the request with the id the buttons were rendered for, never one that replaced it since. */
  function decide(event: MouseEvent, id: string, decision: 'allow' | 'deny', always = false): void {
    event.stopPropagation();
    void window.agenttiles.decidePermission(id, { decision, always });
  }

  function review(event: Event): void {
    event.stopPropagation();
    onAnswer(tile.sessionId);
  }

  /** First heading or line of a plan, for the tile. */
  function planTitle(plan: string): string {
    const line = plan.split('\n').find((l) => l.trim().length > 0) ?? t('tile.ask.plan');
    return line.replace(/^#+\s*/, '').replace(/^Plan:\s*/i, '').trim() || t('tile.ask.plan');
  }

  function enter(): void {
    hoverTimer = setTimeout(() => (hover = true), 450);
  }

  function leave(): void {
    if (hoverTimer) clearTimeout(hoverTimer);
    hover = false;
  }

  // A tile can go away under the mouse (session ended); its hover timer must not fire after that.
  onMount(() => {
    return () => {
      if (hoverTimer) clearTimeout(hoverTimer);
    };
  });

  function focusTile(): void {
    if (!renaming) act('focus');
  }

  function autofocus(node: HTMLInputElement): void {
    node.focus();
    node.select();
  }

  function dragStart(event: DragEvent): void {
    hover = false;
    event.dataTransfer?.setData('text/plain', tile.sessionId);
    onDragStart(tile.sessionId);
  }

  function drop(event: DragEvent): void {
    event.preventDefault();
    dragOver = false;
    onDropOn(tile.sessionId);
  }

  /** Colored segments of the last 30 minutes, as percentages of the strip. */
  const segments = $derived.by(() => {
    const start = now - HISTORY_MS;
    const points = tile.history;
    const result: { state: string; pct: number }[] = [];
    const first = points[0];
    if (!first) return result;
    if (first.at > start) result.push({ state: 'none', pct: ((first.at - start) / HISTORY_MS) * 100 });
    points.forEach((point, i) => {
      const from = Math.max(point.at, start);
      const to = points[i + 1]?.at ?? now;
      if (to > from) result.push({ state: point.state, pct: ((to - from) / HISTORY_MS) * 100 });
    });
    return result;
  });

  const activity = $derived(activityText(tile.activity, t));

  const previousTools = $derived(
    (tile.recentTools.at(-1) === activity ? tile.recentTools.slice(0, -1) : tile.recentTools).slice(-2).reverse(),
  );

  const activityLine = $derived.by(() => {
    if (tile.state === 'limitHit') {
      const reset =
        fiveHourResetsAt !== null
          ? t('tile.limit.resetsIn', { duration: since(now, fiveHourResetsAt * 1000) })
          : t('tile.limit.reached');
      return activity ? t('tile.limit.withActivity', { reset, activity }) : reset;
    }
    return activity ?? '';
  });

  const turnText = $derived.by(() => {
    if (tile.turnStartedAt !== null) return t('tile.turn', { duration: since(tile.turnStartedAt, now) });
    if (tile.lastTurnMs !== null && tile.state === 'done') return t('tile.took', { duration: duration(tile.lastTurnMs) });
    return null;
  });

  const showReply = $derived((tile.state === 'done' || tile.state === 'idle') && tile.lastAssistant !== null);

  const contextWarn = $derived(contextWarnPct > 0 && tile.contextPct !== null && tile.contextPct >= contextWarnPct);
  const hasDetails = $derived(
    tile.lastPrompt !== null ||
      tile.lastAssistant !== null ||
      tile.pending !== null ||
      tile.tasks.length > 0 ||
      tile.subagentTypes.length > 0,
  );
  const git = $derived(tile.git);
</script>

<svelte:window onclick={() => (menu = null)} onblur={() => (menu = null)} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="tile {variant} state-{tile.state}"
  class:tinted={TINTED.includes(tile.state)}
  class:selected
  class:drag-over={dragOver}
  style:--c={stateColor(tile.state)}
  role="button"
  tabindex="0"
  draggable={!renaming}
  onclick={focusTile}
  oncontextmenu={openMenu}
  onmouseenter={enter}
  onmouseleave={leave}
  ondragstart={dragStart}
  ondragover={(e) => {
    e.preventDefault();
    dragOver = true;
  }}
  ondragleave={() => (dragOver = false)}
  ondrop={drop}
>
  <div class="top">
    {#if index <= 9}<span class="index" title={t('tile.selectHint', { index })}>{index}</span>{/if}
    <span class="chip"><span class="dot"></span>{stateText(tile.label, t)}</span>
    <span class="since">{since(tile.stateSince, now)}</span>
    {#if turnText}<span class="turn">{turnText}</span>{/if}
    {#if tile.pinned}<span class="pin" title={t('tile.pinned')}>●</span>{/if}
  </div>

  <div class="title">
    {#if renaming}
      <input
        class="rename"
        bind:value={renameValue}
        onkeydown={onRenameKey}
        onblur={commitRename}
        onclick={(e) => e.stopPropagation()}
        use:autofocus
      />
    {:else}
      <div class="name" title={tile.name}>{tile.name}</div>
    {/if}
    <div class="meta">
      <span class="project" title={tile.cwd}>{tile.project}</span>
      {#if tile.model}<span class="badge">{tile.model}</span>{/if}
    </div>
  </div>

  {#if git.branch || git.pr || git.linesAdded !== null}
    <div class="git">
      {#if git.branch}<span class="branch" title={t('tile.git.branch')}>⎇ {git.branch}</span>{/if}
      {#if git.worktree}<span title={t('tile.git.worktree')}>{t('tile.git.worktreeName', { name: git.worktree })}</span>{/if}
      {#if git.pr}<span class="pr" title={git.pr.url ?? ''}>#{git.pr.number}{git.pr.reviewState ? ` · ${git.pr.reviewState}` : ''}</span>{/if}
      {#if git.linesAdded !== null || git.linesRemoved !== null}
        <span class="lines" title={t('tile.git.linesHint')}>
          {#if git.linesAdded !== null}<span class="add">+{git.linesAdded}</span>{/if}
          {#if git.linesRemoved !== null}<span class="del">−{git.linesRemoved}</span>{/if}
        </span>
      {/if}
    </div>
  {/if}

  <div class="log" class:hidden={tile.pending !== null}>
    {#if showReply}
      <!-- Finished or idle: what Claude answered is what matters, not the commands it ran on the way. -->
      <div class="reply" title={tile.lastAssistant}>{plainText(tile.lastAssistant ?? '')}</div>
    {:else}
      {#if !tile.pending}
        <div class="activity" title={activityLine}>{activityLine}</div>
      {/if}
      {#if variant === 'card'}
        {#each previousTools as tool, i (i)}
          <div class="previous" title={tool}>{tool}</div>
        {/each}
      {/if}
    {/if}
  </div>

  {#if tile.pending?.questions}
    {@const questions = tile.pending.questions}
    <div class="ask">
      <span class="ask-text" title={questions.map((q) => q.question).join('\n')}>
        {questions[0]?.question ?? t('tile.ask.question')}
      </span>
      <div class="ask-row">
        {#if questions.length > 1}<span class="ask-more">{t('tile.ask.questions', { count: questions.length })}</span>{/if}
        <button
          class="answer"
          onclick={(e) => {
            e.stopPropagation();
            onAnswer(tile.sessionId);
          }}
        >
          {t('tile.ask.answer')}
        </button>
      </div>
    </div>
  {:else if tile.pending?.plan != null}
    <div class="ask">
      <span class="ask-text" title={t('activity.planReady')}>{planTitle(tile.pending.plan)}</span>
      <div class="ask-row">
        <span class="ask-more">{t('state.planReady')}</span>
        <button class="answer" onclick={review}>{t('tile.ask.reviewPlan')}</button>
      </div>
    </div>
  {:else if tile.pending}
    {@const pending = tile.pending}
    {#if variant === 'card'}
      {#if pending.diff}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="pending-input diff" title={t('tile.pending.diffHint')} onclick={review}>
          <DiffLines lines={pending.diff.lines} limit={12} />
        </div>
      {:else}
        <pre class="pending-input" title={t('tile.pending.fullRequest')}>{prettyInput(pending.toolInput)}</pre>
      {/if}
    {/if}
    <div class="actions">
      <button class="allow" onclick={(e) => decide(e, pending.id, 'allow')} title={prettyInput(pending.toolInput)}>{t('tile.allow')}</button>
      {#if pending.alwaysLabel}
        <button class="always" onclick={(e) => decide(e, pending.id, 'allow', true)} title={pending.alwaysLabel}>{t('tile.always')}</button>
      {/if}
      {#if pending.diff}<button class="review" onclick={review} title={t('tile.diffHint')}>{t('tile.diff')}</button>{/if}
      <button class="deny" onclick={(e) => decide(e, pending.id, 'deny')} title={t('tile.denyHint')}>{t('tile.deny')}</button>
    </div>
  {/if}

  <div class="footer">
    {#if tile.contextPct !== null}
      <span class="context" class:warn={contextWarn} title={t('tile.footer.contextHint')}>
        <span class="bar"><span style:width="{Math.min(100, tile.contextPct)}%"></span></span>
        {Math.round(tile.contextPct)}%
      </span>
      {#if contextWarn}<span class="compact">{t('tile.footer.compactSoon')}</span>{/if}
    {/if}
    {#if tile.costUsd !== null}<span title={t('format.costHint')}>{usd(tile.costUsd)}</span>{/if}
    {#if tile.subagents > 0}<span>{t('tile.footer.agents', { count: tile.subagents })}</span>{/if}
    {#if tile.tasksTotal > 0}<span>{t('tile.footer.tasks', { done: tile.tasksDone, total: tile.tasksTotal })}</span>{/if}
    {#if tile.jobId !== null}<span class="bg" title={t('tile.footer.bgHint')}>{t('tile.footer.bg')}</span>{/if}
    {#if !tile.hooks}<span class="nohooks" title={t('tile.footer.noHooksHint')}>{t('tile.footer.noHooks')}</span>{/if}
  </div>

  {#if variant === 'card'}
    <div class="history" title={t('tile.historyHint')}>
      {#each segments as segment, i (i)}
        <span style:width="{segment.pct}%" style:background={segment.state === 'none' ? 'transparent' : stateColor(segment.state as TileView['state'])}></span>
      {/each}
    </div>
  {/if}

  {#if hover && hasDetails && !menu}
    <div class="details">
      {#if tile.pending && !tile.pending.questions}
        <div class="label">{t('tile.details.wantsToRun', { tool: tile.pending.toolName })}</div>
        <pre>{prettyInput(tile.pending.toolInput)}</pre>
      {/if}
      {#if tile.pending?.questions}
        {#each tile.pending.questions as q, i (i)}
          <div class="label">{q.header || t('tile.details.question')}</div>
          <p>{q.question}</p>
          <ul class="tasks">
            {#each q.options as option, j (j)}
              <li><b>{option.label}</b>{option.description ? ` – ${option.description}` : ''}</li>
            {/each}
          </ul>
        {/each}
      {/if}
      {#if tile.tasks.length > 0}
        <div class="label">{t('tile.details.tasks')}</div>
        <ul class="tasks">
          {#each tile.tasks as task, i (i)}
            <li class:done={task.done}>{task.done ? '☑' : '☐'} {task.subject}</li>
          {/each}
        </ul>
      {/if}
      {#if tile.subagentTypes.length > 0}
        <div class="label">{t('tile.details.runningSubagents')}</div>
        <p>{tile.subagentTypes.join(', ')}</p>
      {/if}
      {#if tile.lastPrompt}
        <div class="label">{t('tile.details.lastPrompt')}</div>
        <p class="md">{@html markdownHtml(tile.lastPrompt)}</p>
      {/if}
      {#if tile.lastAssistant}
        <div class="label">{t('tile.details.lastReply')}</div>
        <p class="md">{@html markdownHtml(tile.lastAssistant)}</p>
      {/if}
    </div>
  {/if}
</div>

{#if menu}
  <div class="menu" style:left="{menu.x}px" style:top="{menu.y}px" role="menu">
    {#if tile.pinned}
      <button onclick={() => act('unpin')}>{t('tile.menu.unpin')}</button>
    {:else}
      <button onclick={() => act('pin')}>{t('tile.menu.pin')}</button>
    {/if}
    <button onclick={startRename} title={t('tile.menu.renameHint')}>{t('tile.menu.rename')}</button>
    <hr />
    <button onclick={() => act('hideSession')}>{t('tile.menu.hideSession')}</button>
    <button onclick={() => act('hideProject')}>{t('tile.menu.hideProject')}</button>
    <hr />
    <button onclick={() => act('openFolder')}>{t('tile.menu.openFolder')}</button>
    <button onclick={() => act('copySessionId')}>{t('tile.menu.copySessionId')}</button>
    {#if tile.jobId !== null}
      <hr />
      <button onclick={() => act('stop')}>{t('tile.menu.stopBackground')}</button>
    {/if}
  </div>
{/if}

<style>
  .tile {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.35em;
    /* Every card has exactly this size (App computes pages from it); content gets fixed slots. */
    height: 16.5em;
    padding: 0.8em 0.95em 0.95em;
    font-size: calc(13px * var(--scale, 1));
    background: var(--surface);
    border: 1px solid var(--border);
    border-top: 0.3em solid var(--c);
    border-radius: 0.8em;
    cursor: pointer;
    outline: none;
    transition: background 120ms;
  }

  .tile:hover {
    background: var(--surface-2);
  }

  .tile.tinted {
    background: color-mix(in srgb, var(--c) 14%, var(--surface));
    border-color: color-mix(in srgb, var(--c) 45%, var(--border));
  }

  .tile.selected {
    box-shadow: 0 0 0 2px var(--accent);
  }

  .tile.drag-over {
    outline: 2px dashed var(--muted);
    outline-offset: 2px;
  }

  .tile:focus-visible {
    box-shadow: 0 0 0 2px var(--accent);
  }

  .state-needsApproval {
    animation: blink 1.2s ease-in-out infinite;
  }

  @keyframes blink {
    50% {
      border-color: var(--c);
      box-shadow: 0 0 0 1px var(--c), 0 0 18px color-mix(in srgb, var(--c) 45%, transparent);
    }
  }

  .top,
  .title,
  .git,
  .actions,
  .ask,
  .footer {
    flex-shrink: 0;
  }

  .top {
    display: flex;
    align-items: center;
    gap: 0.6em;
    min-width: 0;
  }

  .index {
    display: grid;
    place-items: center;
    min-width: 1.5em;
    height: 1.5em;
    border-radius: 0.35em;
    background: var(--surface-2);
    color: var(--muted);
    font-size: 0.8em;
    font-weight: 600;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.45em;
    padding: 0.08em 0.6em 0.08em 0.45em;
    border-radius: 999px;
    background: color-mix(in srgb, var(--c) 18%, transparent);
    color: var(--c);
    font-weight: 600;
    font-size: 0.85em;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .dot {
    width: 0.55em;
    height: 0.55em;
    border-radius: 50%;
    background: var(--c);
  }

  .state-working .dot,
  .state-compacting .dot {
    animation: pulse 1.4s ease-in-out infinite;
  }

  @keyframes pulse {
    50% {
      opacity: 0.25;
      transform: scale(0.7);
    }
  }

  .since,
  .turn {
    color: var(--muted);
    font-size: 0.85em;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .pin {
    margin-left: auto;
    color: var(--accent);
    font-size: 0.75em;
  }

  .title {
    min-width: 0;
  }

  .name {
    font-size: 1.15em;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .rename {
    width: 100%;
    font-size: 1.05em;
    font-weight: 600;
  }

  .meta,
  .git {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2em 0.6em;
    color: var(--muted);
    font-size: 0.92em;
    min-width: 0;
  }

  .project,
  .branch {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .badge {
    flex-shrink: 0;
    padding: 0 0.45em;
    border: 1px solid var(--border);
    border-radius: 0.3em;
    font-size: 0.85em;
  }

  .git {
    font-family: var(--mono);
    font-size: 0.85em;
  }

  .pr {
    color: var(--accent);
  }

  .lines {
    display: inline-flex;
    gap: 0.6em;
    cursor: help;
  }

  .add {
    color: var(--st-done);
  }

  .del {
    color: var(--st-error);
  }

  .log {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    min-width: 0;
    font-family: var(--mono);
    font-size: 0.92em;
    line-height: 1.35;
  }

  .activity {
    color: var(--text);
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow-wrap: anywhere;
  }

  .reply {
    font-family: var(--sans);
    font-size: 1.05em;
    line-height: 1.4;
    color: var(--text);
    opacity: 0.85;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow-wrap: anywhere;
  }

  .tile.row .reply {
    display: block;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .previous {
    color: var(--muted);
    opacity: 0.75;
    font-size: 0.9em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .actions {
    display: flex;
    gap: 0.6em;
  }

  .ask {
    display: flex;
    flex-direction: column;
    gap: 0.45em;
  }

  .ask-text {
    font-weight: 600;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .ask-row {
    display: flex;
    align-items: center;
    gap: 0.6em;
  }

  .ask-more {
    color: var(--muted);
    font-size: 0.85em;
  }

  .answer {
    margin-left: auto;
    padding: 0.4em 1.1em;
    border: none;
    border-radius: 0.45em;
    background: var(--st-needsInput);
    color: #fff;
    font-weight: 700;
  }

  .tile.row .ask {
    grid-area: actions;
    flex-direction: row;
    align-items: center;
  }

  .tile.row .ask-text {
    display: none;
  }

  .log.hidden {
    display: none;
  }

  .pending-input {
    flex: 1 1 auto;
    min-height: 0;
    margin: 0;
    overflow: auto;
    padding: 0.4em 0.6em;
    background: color-mix(in srgb, var(--surface) 70%, transparent);
    border: 1px solid var(--border);
    border-radius: 0.4em;
    font-family: var(--mono);
    font-size: 0.85em;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    cursor: text;
    user-select: text;
  }

  .actions button {
    flex: 1;
    padding: 0.45em 0;
    border: none;
    border-radius: 0.45em;
    font-weight: 600;
  }

  .allow {
    background: var(--st-done);
    color: #fff;
  }

  .always {
    background: color-mix(in srgb, var(--st-done) 65%, var(--surface-2));
    color: #fff;
  }

  .review {
    background: var(--surface-2);
    border: 1px solid var(--border) !important;
    color: var(--text);
  }

  .pending-input.diff {
    padding: 0.2em 0;
    white-space: normal;
    cursor: zoom-in;
  }

  .deny {
    background: var(--st-error);
    color: #fff;
  }

  .footer {
    margin-top: auto;
    display: flex;
    flex-wrap: nowrap;
    overflow: hidden;
    white-space: nowrap;
    align-items: center;
    gap: 0.3em 0.8em;
    color: var(--muted);
    font-size: 0.85em;
    font-variant-numeric: tabular-nums;
  }

  .context {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
  }

  .context .bar {
    width: 3.5em;
    height: 0.35em;
    border-radius: 0.2em;
    background: var(--surface-2);
    overflow: hidden;
  }

  .context .bar span {
    display: block;
    height: 100%;
    background: var(--st-working);
  }

  .context.warn .bar span {
    background: var(--st-needsApproval);
  }

  .compact {
    color: var(--st-needsApproval);
    font-weight: 600;
  }

  .nohooks {
    color: var(--st-needsApproval);
  }

  .bg {
    color: var(--accent);
  }

  .history {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    height: 0.25em;
    border-radius: 0 0 0.8em 0.8em;
    overflow: hidden;
    background: var(--surface-2);
    opacity: 0.85;
  }

  .details {
    position: absolute;
    z-index: 20;
    left: 0;
    right: 0;
    top: calc(100% + 6px);
    min-width: 260px;
    max-height: 22em;
    overflow: auto;
    padding: 0.8em 0.95em;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 0.6em;
    box-shadow: var(--shadow);
    cursor: default;
    user-select: text;
    font-size: 13px;
  }

  .details .label {
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-top: 6px;
  }

  .details .label:first-child {
    margin-top: 0;
  }

  .details p,
  .details pre {
    margin: 2px 0 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .md :global(code) {
    font-family: var(--mono);
    font-size: 0.92em;
  }

  .md :global(pre) {
    margin: 2px 0;
    font-family: var(--mono);
  }

  .details pre {
    font-family: var(--mono);
    font-size: 12px;
  }

  .tasks {
    margin: 2px 0 0;
    padding: 0;
    list-style: none;
  }

  .tasks li.done {
    color: var(--muted);
    text-decoration: line-through;
  }

  /* ---- list rows ---- */

  .tile.row {
    display: grid;
    grid-template-columns: 16em minmax(10em, 1.3fr) minmax(12em, 2fr) minmax(0, 1fr) auto auto;
    grid-template-areas: 'top title log git footer actions';
    align-items: center;
    gap: 0 1em;
    height: 3.6em;
    padding: 0.4em 0.9em;
    border-top: 1px solid var(--border);
    border-left: 0.3em solid var(--c);
    border-radius: 0.5em;
  }

  .tile.row .top {
    grid-area: top;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }

  .tile.row .title {
    grid-area: title;
    display: flex;
    flex-direction: column;
  }

  .tile.row .log {
    grid-area: log;
  }

  .tile.row .git {
    grid-area: git;
    flex-wrap: nowrap;
    overflow: hidden;
  }

  .tile.row .footer {
    grid-area: footer;
    flex-wrap: nowrap;
  }

  .tile.row .actions {
    grid-area: actions;
  }

  .tile.row .actions button {
    padding: 0.3em 0.9em;
  }

  .tile.row .name {
    font-size: 1.05em;
  }

  .tile.row .activity {
    display: block;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .tile.row .details {
    left: 13em;
    right: auto;
    width: 32em;
  }

  .menu {
    position: fixed;
    z-index: 50;
    min-width: 170px;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow);
  }

  .menu button {
    display: block;
    width: 100%;
    padding: 6px 10px;
    text-align: left;
    background: none;
    border: none;
    border-radius: 5px;
  }

  .menu button:hover {
    background: var(--surface-2);
  }

  .menu hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 4px 0;
  }
</style>
