<script lang="ts">
  import type { HeaderView, RateLimit, UpdateView, ViewMode } from '../../../core/types';
  import type { StatusFilter } from '../layout';
  import { clock, since, usd } from '../format';
  import { locale, t } from '../i18n.svelte';

  interface Props {
    header: HeaderView;
    now: number;
    viewMode: ViewMode;
    fullscreen: boolean;
    onSettings: () => void;
    onDoctor: () => void;
    onToday: () => void;
    filters: StatusFilter[];
    onFilter: (filter: StatusFilter) => void;
    grouped: boolean;
    onGroup: () => void;
    onNewSession: () => void;
    update: UpdateView | null;
    onUpdate: () => void;
    onViewMode: (mode: ViewMode) => void;
    onFullscreen: () => void;
    onRefreshLimits: () => void;
    refreshingLimits: boolean;
  }

  let {
    header,
    now,
    viewMode,
    fullscreen,
    onSettings,
    onDoctor,
    onToday,
    filters,
    onFilter,
    grouped,
    onGroup,
    onNewSession,
    update,
    onUpdate,
    onViewMode,
    onFullscreen,
    onRefreshLimits,
    refreshingLimits,
  }: Props = $props();

  /** Fill of each of the 10 boxes (one box = 10 %), 0..1; the last started box is filled partially. */
  /** Limits are only learned from statusline runs; older values are shown dimmed with their age. */
  const STALE_MS = 10 * 60 * 1000;

  function stale(limit: RateLimit | null): boolean {
    return limit !== null && now - limit.observedAt > STALE_MS;
  }

  function boxes(limit: RateLimit | null): number[] {
    const tenths = Math.min(100, Math.max(0, limit?.usedPct ?? 0)) / 10;
    return Array.from({ length: 10 }, (_, i) => Math.min(1, Math.max(0, tenths - i)));
  }
</script>

{#snippet bar(label: string, limit: RateLimit | null, eta: number | null)}
  <div
    class="item limit"
    class:empty={!limit}
    class:stale={stale(limit)}
    title={limit
      ? t('header.limits.tooltip', {
          label,
          pct: limit.usedPct.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
          time: new Date(limit.observedAt).toLocaleString(locale()),
        })
      : t('header.limits.noData')}
  >
    <span class="label">{label}</span>
    <div class="boxes" aria-label={t('header.limits.usage', { label, pct: limit ? Math.round(limit.usedPct) : 0 })}>
      {#each boxes(limit) as fill, i (i)}
        <span class="box"><span class="box-fill" style:width="{fill * 100}%"></span></span>
      {/each}
    </div>
    <b>{limit ? `${Math.round(limit.usedPct)}%` : '–'}</b>
    {#if limit && stale(limit)}
      <span class="label">{t('header.limits.asOf', { time: since(limit.observedAt, now) })}</span>
    {:else if limit?.resetsAt}
      <span class="label">{t('header.limits.resets', { time: since(now, limit.resetsAt * 1000) })}</span>
    {/if}
    {#if eta !== null}
      <span class="eta" title={t('header.limits.etaHint')}>
        {t('header.limits.eta', { time: clock(eta) })}
      </span>
    {/if}
  </div>
{/snippet}

<header>
  <div class="group" role="group" aria-label={t('header.filter.group')} data-tour="counters">
    {#each [['working', header.working, 'var(--st-working)'], ['waiting', header.waiting, 'var(--st-needsApproval)'], ['done', header.done, 'var(--st-done)']] as const as [filter, count, color] (filter)}
      <button
        class="item filter"
        class:active={filters.includes(filter)}
        style:--c={color}
        aria-pressed={filters.includes(filter)}
        onclick={() => onFilter(filter)}
        title={filters.includes(filter)
          ? t('header.filter.stop', { filter: t(`header.filter.${filter}`) })
          : t('header.filter.showOnly', { filter: t(`header.filter.${filter}`) })}
      >
        <b>{count}</b><span class="label">{t(`header.filter.${filter}`)}</span>
      </button>
    {/each}
  </div>
  <span class="sep"></span>
  <button
    class="group limits"
    class:refreshing={refreshingLimits}
    onclick={onRefreshLimits}
    disabled={refreshingLimits}
    title={t('header.limits.refresh')}
  >
    {@render bar(t('header.limits.fiveHour'), header.fiveHour, header.fiveHourEta)}
    {@render bar(t('header.limits.sevenDay'), header.sevenDay, null)}
  </button>
  <span class="sep"></span>
  <button class="item today" onclick={onToday} title={t('format.usageCostHint')}>
    <b>{usd(header.today.costUsd)}</b><span class="label">{t('header.today')}</span>
  </button>
  <div class="buttons">
    {#if update?.failed}
      <button class="update failed" onclick={onUpdate} title={t('header.update.failedHint')}>{t('header.update.failed')}</button>
    {:else if update?.available}
      <button
        class="update"
        onclick={onUpdate}
        title={t('header.update.availableHint', { current: update.current, available: update.available })}
      >
        {t('header.update.available', { version: update.available })}
      </button>
    {/if}
    <button onclick={onNewSession} title={t('header.newSessionHint')} aria-label={t('header.newSession')} data-tour="newSession">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
    <button
      class:on={grouped}
      onclick={onGroup}
      title={grouped ? t('header.ungroup') : t('header.group')}
      aria-label={t('header.group')}
      aria-pressed={grouped}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
    </button>
    <button
      onclick={() => onViewMode(viewMode === 'tiles' ? 'list' : 'tiles')}
      title={viewMode === 'tiles' ? t('header.showList') : t('header.showTiles')}
      aria-label={t('header.toggleView')}
    >
      {#if viewMode === 'tiles'}
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
        </svg>
      {/if}
    </button>
    <button
      onclick={onFullscreen}
      title={fullscreen ? t('header.exitFullscreenHint') : t('header.fullscreenHint')}
      aria-label={fullscreen ? t('header.exitFullscreen') : t('header.fullscreen')}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        {#if fullscreen}
          <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
        {:else}
          <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
        {/if}
      </svg>
    </button>
    <button onclick={onDoctor} title={t('header.diagnostics')} aria-label={t('header.diagnostics')}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    </button>
    <button onclick={onSettings} title={t('header.settings')} aria-label={t('header.settings')} data-tour="settings">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3" />
        <path
          d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        />
      </svg>
    </button>
  </div>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 16px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .group {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 16px;
  }

  .sep {
    align-self: center;
    width: 1px;
    height: 20px;
    background: var(--border);
  }

  /* 5h above 7d; fixed label and percentage widths keep both rows aligned. */
  .group.limits {
    flex-direction: column;
    align-items: flex-start;
    flex-wrap: nowrap;
    gap: 3px;
    padding: 3px 6px;
    margin: -3px -6px;
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
  }

  .group.limits:hover {
    border-color: var(--border);
  }

  .group.limits.refreshing {
    cursor: progress;
    animation: refreshing 1s ease-in-out infinite;
  }

  @keyframes refreshing {
    50% {
      opacity: 0.45;
    }
  }

  .group.limits + .sep {
    height: 36px;
  }

  .limit > .label:first-child {
    width: 18px;
  }

  .limit b {
    min-width: 34px;
    text-align: right;
  }

  /* One pattern for every header item: bold value, muted label, same size. */
  .item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    white-space: nowrap;
  }

  .filter {
    padding: 3px 8px;
    margin: -3px -8px;
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
  }

  .filter:hover {
    border-color: var(--border);
  }

  /* Counters left out of an active filter fade, so the filter reads as one. */
  .group:has(.filter.active) .filter:not(.active) {
    opacity: 0.45;
  }

  .filter.active {
    background: color-mix(in srgb, var(--c) 16%, transparent);
    border-color: color-mix(in srgb, var(--c) 55%, transparent);
  }

  .buttons button.update {
    width: auto;
    padding: 4px 10px;
    border: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--text);
    font-size: 12px;
    font-weight: 600;
  }

  .buttons button.update.failed {
    border-color: color-mix(in srgb, var(--st-error) 60%, transparent);
    background: color-mix(in srgb, var(--st-error) 16%, transparent);
  }

  .buttons button.on {
    color: var(--accent);
  }

  .item b {
    color: var(--c, var(--text));
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .label {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .boxes {
    display: flex;
    gap: 2px;
  }

  .box {
    position: relative;
    width: 8px;
    height: 14px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--claude) 14%, var(--surface-2));
    overflow: hidden;
  }

  .box-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--claude);
  }

  .limit.empty .box {
    background: var(--surface-2);
  }

  .limit.stale .boxes,
  .limit.stale b {
    opacity: 0.5;
  }

  .eta {
    padding: 0 6px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--st-needsApproval) 18%, transparent);
    color: var(--st-needsApproval);
    font-weight: 600;
    white-space: nowrap;
  }

  .today {
    padding: 3px 6px;
    margin: -3px -6px;
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
  }

  .today:hover {
    border-color: var(--border);
  }

  .buttons {
    margin-left: auto;
    display: flex;
    gap: 4px;
  }

  .buttons button {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--muted);
  }

  .buttons button:hover {
    border-color: var(--border);
    color: var(--text);
  }
</style>
