<script lang="ts">
  import type { EndedAction, EndedTileView } from '../../../core/types';
  import { dateTime, plainText, since } from '../format';
  import { t } from '../i18n.svelte';

  interface Props {
    tile: EndedTileView;
    now: number;
    variant: 'card' | 'row';
  }

  let { tile, now, variant }: Props = $props();

  let menu = $state<{ x: number; y: number } | null>(null);

  function act(event: Event, action: EndedAction): void {
    event.stopPropagation();
    menu = null;
    void window.agenttiles.endedAction(tile.sessionId, action);
  }

  function openMenu(event: MouseEvent): void {
    event.preventDefault();
    menu = {
      x: Math.max(0, Math.min(event.clientX, window.innerWidth - 180)),
      y: Math.max(0, Math.min(event.clientY, window.innerHeight - 200)),
    };
  }

  /** What the session ended with: Claude's last reply, else the last prompt. */
  const last = $derived(tile.lastAssistant ?? tile.lastPrompt);
</script>

<svelte:window onclick={() => (menu = null)} onblur={() => (menu = null)} />

<!-- No click action: an ended session has no terminal to jump to, and resuming is a deliberate button. -->
<div class="tile ended {variant}" role="group" aria-label={tile.name} oncontextmenu={openMenu}>
  <div class="top">
    <span class="chip"><span class="dot"></span>{t('state.ended')}</span>
    <span class="since" title={t('tile.ended.sinceHint', { time: dateTime(tile.endedAt) })}>{since(tile.endedAt, now)}</span>
    <button class="remove" onclick={(e) => act(e, 'remove')} title={t('tile.ended.removeHint')} aria-label={t('tile.ended.remove')}>✕</button>
  </div>

  <div class="title">
    <div class="name" title={tile.name}>{tile.name}</div>
    <div class="meta"><span class="project" title={tile.cwd}>{tile.project}</span></div>
  </div>

  <div class="log">
    {#if last !== null}
      <div class="last" class:prompt={tile.lastAssistant === null} title={last}>{plainText(last)}</div>
    {/if}
  </div>

  <div class="actions">
    <button onclick={(e) => act(e, 'resume')} title={t('tile.ended.resumeHint')}>↻ {t('tile.ended.resume')}</button>
    <button onclick={(e) => act(e, 'fork')} title={t('tile.forkHint')}>⑂ {t('tile.ended.fork')}</button>
  </div>
</div>

{#if menu}
  <div class="menu" style:left="{menu.x}px" style:top="{menu.y}px" role="menu">
    <button onclick={(e) => act(e, 'resume')} title={t('tile.ended.resumeHint')}>{t('tile.menu.resume')}</button>
    <button onclick={(e) => act(e, 'fork')} title={t('tile.forkHint')}>{t('tile.menu.fork')}</button>
    <hr />
    <button onclick={(e) => act(e, 'openFolder')}>{t('tile.menu.openFolder')}</button>
    <button onclick={(e) => act(e, 'copySessionId')}>{t('tile.menu.copySessionId')}</button>
    <hr />
    <button onclick={(e) => act(e, 'remove')}>{t('tile.menu.remove')}</button>
  </div>
{/if}

<style>
  /* Same geometry as a live tile (App computes pages from it), muted so live sessions stand out. */
  .tile {
    --c: var(--muted);
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.35em;
    height: 16.5em;
    padding: 0.8em 0.95em 0.95em;
    font-size: calc(13px * var(--scale, 1));
    background: var(--surface);
    border: 1px dashed var(--border);
    border-top: 0.3em solid var(--border);
    border-radius: 0.8em;
    opacity: 0.7;
    transition: opacity 120ms;
  }

  .tile:hover,
  .tile:focus-within {
    opacity: 1;
  }

  .top,
  .title,
  .actions {
    flex-shrink: 0;
  }

  .top {
    display: flex;
    align-items: center;
    gap: 0.6em;
    min-width: 0;
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
    border: 1px solid var(--c);
  }

  .since {
    color: var(--muted);
    font-size: 0.85em;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .remove {
    margin-left: auto;
    padding: 0.1em 0.45em;
    background: none;
    border: none;
    border-radius: 0.35em;
    color: var(--muted);
    line-height: 1;
  }

  .remove:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .title {
    min-width: 0;
  }

  .name {
    font-size: 1.15em;
    font-weight: 600;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meta {
    color: var(--muted);
    font-size: 0.92em;
    min-width: 0;
  }

  .project {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .log {
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }

  .last {
    color: var(--muted);
    line-height: 1.4;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow-wrap: anywhere;
  }

  .last.prompt {
    font-style: italic;
  }

  .actions {
    display: flex;
    gap: 0.6em;
  }

  .actions button {
    flex: 1;
    padding: 0.45em 0;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 0.45em;
    color: var(--text);
    font-weight: 600;
    white-space: nowrap;
  }

  .actions button:hover {
    border-color: var(--accent);
  }

  /* ---- list rows ---- */

  .tile.row {
    display: grid;
    grid-template-columns: 16em minmax(10em, 1.3fr) minmax(12em, 3fr) auto;
    grid-template-areas: 'top title log actions';
    align-items: center;
    gap: 0 1em;
    height: 3.6em;
    padding: 0.4em 0.9em;
    border-top: 1px dashed var(--border);
    border-left: 0.3em solid var(--border);
    border-radius: 0.5em;
  }

  .tile.row .top {
    grid-area: top;
    overflow: hidden;
    white-space: nowrap;
  }

  .tile.row .title {
    grid-area: title;
  }

  .tile.row .name {
    font-size: 1.05em;
  }

  .tile.row .log {
    grid-area: log;
  }

  .tile.row .last {
    display: block;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .tile.row .actions {
    grid-area: actions;
  }

  .tile.row .actions button {
    padding: 0.3em 0.9em;
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
