<script lang="ts">
  import { onMount } from 'svelte';
  import type { Settings as SettingsType, SettingsView, Snapshot, TileSize, TileView, UpdateView, ViewMode } from '../../core/types';
  import Header from './components/Header.svelte';
  import Tile from './components/Tile.svelte';
  import Banner from './components/Banner.svelte';
  import Settings from './components/Settings.svelte';
  import Doctor from './components/Doctor.svelte';
  import Stats from './components/Stats.svelte';
  import QuestionDialog from './components/QuestionDialog.svelte';
  import ReviewDialog from './components/ReviewDialog.svelte';
  import NewSession from './components/NewSession.svelte';
  import Tour from './components/Tour.svelte';
  import WithCode from './components/WithCode.svelte';
  import { setLocale, t } from './i18n.svelte';
  import { snapshot as demoSnapshot } from '../../core/demo';
  import { filterTiles, groupTiles, paginate, type StatusFilter } from './layout';
  import { NEEDS_YOU, paintTaskbarBadge, paintTrayIcon } from './format';
  import { SOUND_PRIORITY, playCue } from './sounds';
  import { comboOf } from './keys';
  import type { KeyAction } from '../../core/types';

  /** Minimum gap between two cues, so a burst of changes does not turn into noise. */
  const SOUND_GAP_MS = 1500;
  let lastSoundAt = 0;
  let refreshingLimits = $state(false);

  async function refreshLimits(): Promise<void> {
    refreshingLimits = true;
    try {
      await window.agenttiles.refreshLimits();
    } finally {
      refreshingLimits = false;
    }
  }

  /** Plays the most urgent enabled cue of a batch of state changes. */
  function onTransitions(states: string[]): void {
    const enabled = settingsView?.settings.sounds;
    if (!enabled || Date.now() - lastSoundAt < SOUND_GAP_MS) return;
    const cue = SOUND_PRIORITY.find((state) => states.includes(state) && enabled[state]);
    if (!cue) return;
    lastSoundAt = Date.now();
    playCue(cue, settingsView?.settings.soundVolume ?? 80);
  }

  /** Tile geometry in em of the tile font; every tile has exactly this size. */
  const CARD_W_EM = 21;
  const CARD_H_EM = 16.5;
  const ROW_H_EM = 3.6;
  const BASE_FONT_PX = 13;
  const SCALE: Record<TileSize, number> = { S: 0.85, M: 1, L: 1.25 };
  const GAP = 12;
  const ROW_GAP = 6;
  /** main's padding (16px sides, 14px top, 24px bottom) plus the pager bar, always reserved so pages stay stable. */
  const PAD_X = 32;
  const PAD_Y = 38 + 34;
  /** Project heading in grouped mode: 22px line plus 6px to its tiles. */
  const HEADING_PX = 28;

  /** The sessions from main; while the tour runs, the dashboard shows invented ones instead. */
  let live = $state<Snapshot>({
    tiles: [],
    header: {
      working: 0,
      waiting: 0,
      done: 0,
      fiveHour: null,
      sevenDay: null,
      fiveHourEta: null,
      today: { sessions: 0, turns: 0, workingMs: 0, waitingMs: 0, costUsd: 0 },
    },
  });
  let now = $state(Date.now());
  let touring = $state(false);
  let tourSnapshot = $state<Snapshot | null>(null);
  const snapshot = $derived(touring && tourSnapshot ? tourSnapshot : live);
  let settingsView = $state<SettingsView | null>(null);
  let showSettings = $state(false);
  let showDoctor = $state(false);
  let showToday = $state(false);
  let showNewSession = $state(false);
  let update = $state<UpdateView | null>(null);
  /** Header counters as filters; empty shows every tile. Not saved: AgentTiles always starts unfiltered. */
  let filters = $state<StatusFilter[]>([]);
  let installing = $state(false);
  let fullscreen = $state(false);
  let selectedId = $state<string | null>(null);
  /** The question, plan or file change open in a dialog: its session and request. */
  let answeringKey = $state<{ sessionId: string; pendingId: string } | null>(null);
  let dragId: string | null = null;
  let mainWidth = $state(0);
  let mainHeight = $state(0);
  let page = $state(0);
  let lastTray = '';

  const settings = $derived<SettingsType | null>(settingsView?.settings ?? null);
  const viewMode = $derived<ViewMode>(settings?.viewMode ?? 'tiles');
  const grouped = $derived(settings?.groupByProject ?? false);
  const shownTiles = $derived(filterTiles(snapshot.tiles, filters));
  /** Shown tiles in screen order (grouped by project when on); 1–9 follow this order. */
  const indexed = $derived(
    groupTiles(shownTiles.map((tile) => ({ tile })), grouped)
      .flatMap((block) => block.items)
      .map(({ tile }, i) => ({ tile, index: i + 1 })),
  );
  const indexOf = $derived(new Map(indexed.map(({ tile, index }) => [tile.sessionId, index])));
  /** The banner lists every waiting session; one hidden by the filter has no number. */
  const waiting = $derived(
    snapshot.tiles
      .filter((tile) => NEEDS_YOU.includes(tile.state))
      .map((tile) => ({ tile, index: indexOf.get(tile.sessionId) ?? Number.POSITIVE_INFINITY })),
  );

  function toggleFilter(filter: StatusFilter): void {
    filters = filters.includes(filter) ? filters.filter((f) => f !== filter) : [...filters, filter];
    page = 0;
  }
  /** A request that opens in a dialog: a question, a plan or a file change. */
  const reviewable = (t: TileView): boolean => !!t.pending && (!!t.pending.questions || t.pending.plan !== null || !!t.pending.diff);
  /** The tile being answered; null once its request is gone (answered in the terminal, timed out). */
  // Bound to the request that was opened: a newer request of the same session never swaps in under the cursor.
  const answering = $derived(
    snapshot.tiles.find(
      (t) => t.sessionId === answeringKey?.sessionId && t.pending?.id === answeringKey.pendingId && reviewable(t),
    ) ?? null,
  );

  function openAnswer(sessionId: string): void {
    const pending = snapshot.tiles.find((t) => t.sessionId === sessionId)?.pending;
    answeringKey = pending ? { sessionId, pendingId: pending.id } : null;
  }
  const overlayOpen = $derived(
    showSettings ||
      showDoctor ||
      showToday ||
      showNewSession ||
      answering !== null ||
      touring ||
      (settingsView?.askHooks ?? false),
  );

  const scale = $derived(SCALE[settings?.tileSize ?? 'M']);
  const fontPx = $derived(BASE_FONT_PX * scale);
  const cardWidthPx = $derived(Math.round(CARD_W_EM * fontPx));

  /** How many columns fit the window at the fixed tile size. */
  const columns = $derived(
    viewMode === 'list' ? 1 : Math.max(1, Math.floor((Math.max(0, mainWidth - PAD_X) + GAP) / (cardWidthPx + GAP))),
  );
  /** Pages of blocks (one per project when grouped); what does not fit goes to further pages. */
  const pageBlocks = $derived(
    paginate(groupTiles(indexed, grouped), {
      columns,
      height: Math.max(0, mainHeight - PAD_Y),
      rowHeight: (viewMode === 'list' ? ROW_H_EM : CARD_H_EM) * fontPx,
      rowGap: viewMode === 'list' ? ROW_GAP : GAP,
      headingHeight: HEADING_PX,
    }),
  );
  const pages = $derived(pageBlocks.length);
  const visibleBlocks = $derived(pageBlocks[page] ?? []);

  function showTile(sessionId: string): void {
    const index = pageBlocks.findIndex((blocks) => blocks.some((b) => b.items.some(({ tile }) => tile.sessionId === sessionId)));
    if (index >= 0) page = index;
  }

  async function refreshSettings(): Promise<void> {
    settingsView = await window.agenttiles.getSettings();
  }

  async function openSettings(): Promise<void> {
    await refreshSettings();
    showSettings = true;
  }

  async function setViewMode(mode: ViewMode): Promise<void> {
    settingsView = await window.agenttiles.updateSettings({ viewMode: mode });
  }

  function startTour(): void {
    showSettings = false;
    filters = [];
    page = 0;
    selectedId = null;
    tourSnapshot = demoSnapshot(Date.now());
    touring = true;
  }

  async function finishTour(): Promise<void> {
    touring = false;
    tourSnapshot = null;
    settingsView = await window.agenttiles.finishTour();
  }

  async function installFromTour(): Promise<void> {
    installing = true;
    try {
      await window.agenttiles.setHooks(true);
      await window.agenttiles.setStatusline(true);
      await finishTour();
      if (settingsView?.integration.error) showSettings = true;
    } finally {
      installing = false;
    }
  }

  async function installFromPrompt(): Promise<void> {
    installing = true;
    try {
      await window.agenttiles.setHooks(true);
      await window.agenttiles.setStatusline(true);
      settingsView = await window.agenttiles.closeHookPrompt(false);
      if (settingsView.integration.error) showSettings = true;
    } finally {
      installing = false;
    }
  }

  async function closeHookPrompt(forever: boolean): Promise<void> {
    settingsView = await window.agenttiles.closeHookPrompt(forever);
  }

  /** For D (deny): the selected tile when it has a pending permission, otherwise the longest waiting one. */
  function permissionTarget(): TileView | null {
    // Questions and plans are answered, not denied; D never touches them.
    const deniable = (t: TileView): boolean => t.pending !== null && t.pending.questions === null && t.pending.plan === null;
    const selected = snapshot.tiles.find((t) => t.sessionId === selectedId);
    if (selected && deniable(selected)) return selected;
    const pending = snapshot.tiles.filter(deniable);
    pending.sort((a, b) => a.stateSince - b.stateSince);
    return pending[0] ?? null;
  }

  /** The configured action for a key combo, if enabled. selectTile is matched separately (keys 1–9). */
  function actionFor(combo: string): KeyAction | null {
    const keys = settings?.keys;
    if (!keys) return null;
    const actions = Object.keys(keys) as KeyAction[];
    return actions.find((a) => a !== 'selectTile' && keys[a].enabled && keys[a].key === combo) ?? null;
  }

  function onKey(event: KeyboardEvent): void {
    // Overlays always close with Esc, whatever the shortcut settings say.
    if (event.key === 'Escape' && (showNewSession || showToday || showDoctor || showSettings)) {
      if (showNewSession) showNewSession = false;
      else if (showToday) showToday = false;
      else if (showDoctor) showDoctor = false;
      else showSettings = false;
      return;
    }
    const target = event.target as HTMLElement | null;
    const combo = comboOf(event);
    if (!combo) return;
    const action = actionFor(combo);
    // Full screen works everywhere, also in a text field or with an overlay open; not while a shortcut is recorded.
    if (action === 'fullscreen' && !target?.classList.contains('recorder')) {
      event.preventDefault();
      void window.agenttiles.toggleFullscreen();
      return;
    }
    if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
    if (overlayOpen) return;
    if (settings?.keys.selectTile.enabled && /^[1-9]$/.test(combo)) {
      selectedId = indexed[Number(combo) - 1]?.tile.sessionId ?? selectedId;
      if (selectedId) showTile(selectedId);
      return;
    }
    if (!action) return;
    event.preventDefault();
    if (action === 'escape') {
      if (selectedId) selectedId = null;
      else if (fullscreen) void window.agenttiles.toggleFullscreen();
      return;
    }
    if (action === 'nextPage' || action === 'prevPage') {
      page = Math.max(0, Math.min(pages - 1, page + (action === 'nextPage' ? 1 : -1)));
      return;
    }
    // Allow is click-only on purpose: approving must be a deliberate act on a request the user can see.
    if (event.repeat) return;
    const selectedTile = snapshot.tiles.find((t) => t.sessionId === selectedId);
    if (action === 'jump' && selectedTile && reviewable(selectedTile)) {
      openAnswer(selectedTile.sessionId);
    } else if (action === 'jump' && selectedId) {
      void window.agenttiles.tileAction(selectedId, 'focus');
    } else if (action === 'deny') {
      const tile = permissionTarget();
      if (tile?.pending) void window.agenttiles.decidePermission(tile.pending.id, { decision: 'deny' });
    }
  }

  function onDropOn(targetId: string): void {
    const source = dragId;
    dragId = null;
    if (!source || source === targetId) return;
    const ids = snapshot.tiles.map((t) => t.sessionId).filter((id) => id !== source);
    ids.splice(ids.indexOf(targetId), 0, source);
    void window.agenttiles.setOrder(ids);
  }

  onMount(() => {
    // No expression body: returning the reactive proxy would make contextBridge try (and fail) to clone it back.
    window.agenttiles.onSnapshot((next) => {
      live = next;
    });
    window.agenttiles.onOpenSettings(() => void openSettings());
    window.agenttiles.onSettingsChanged(() => {
      if (showSettings) void refreshSettings();
    });
    window.agenttiles.onFullscreen((value) => (fullscreen = value));
    window.agenttiles.onTransitions(onTransitions);
    window.agenttiles.onUpdate((next) => {
      update = next;
    });
    void window.agenttiles.getUpdate().then((initial) => (update = initial));
    void window.agenttiles.isFullscreen().then((value) => (fullscreen = value));
    void window.agenttiles.getSnapshot().then((initial) => (live = initial));
    void refreshSettings();
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  $effect(() => {
    if (settingsView?.showTour && !touring) startTour();
  });

  $effect(() => {
    if (settingsView) setLocale(settingsView.locale);
  });

  $effect(() => {
    document.documentElement.classList.toggle('reduce-motion', settings?.reduceMotion ?? false);
  });

  $effect(() => {
    if (selectedId && !snapshot.tiles.some((t) => t.sessionId === selectedId)) selectedId = null;
  });

  $effect(() => {
    if (page > pages - 1) page = pages - 1;
  });

  $effect(() => {
    // The tray and taskbar always count the real sessions, also during the tour.
    const count = live.header.waiting;
    const tooltip = t('app.trayTooltip', { working: live.header.working, waiting: count, done: live.header.done });
    if (tooltip === lastTray) return;
    lastTray = tooltip;
    void window.agenttiles.iconPixelSize().then(async (size) => {
      const icon = await paintTrayIcon(count, size);
      window.agenttiles.setStatusIcons(icon, tooltip, paintTaskbarBadge(count, size), count);
    });
  });
</script>

<svelte:window onkeydown={onKey} />

<!-- A message with a {code} placeholder, rendered with the code part as <code>. -->
<div class="app">
  <Header
    header={snapshot.header}
    {now}
    {viewMode}
    {fullscreen}
    onSettings={() => void openSettings()}
    onDoctor={() => (showDoctor = true)}
    onToday={() => (showToday = true)}
    {filters}
    onFilter={toggleFilter}
    {grouped}
    onGroup={() => void window.agenttiles.updateSettings({ groupByProject: !grouped }).then((v) => (settingsView = v))}
    onNewSession={() => (showNewSession = true)}
    {update}
    onUpdate={() => void window.agenttiles.runUpdate()}
    onViewMode={(mode) => void setViewMode(mode)}
    onFullscreen={() => void window.agenttiles.toggleFullscreen()}
    onRefreshLimits={() => void refreshLimits()}
    {refreshingLimits}
  />

  {#if waiting.length > 0}
    <Banner
      {waiting}
      {now}
      keys={settings?.keys ?? null}
      onAnswer={openAnswer}
    />
  {/if}

  <main bind:clientWidth={mainWidth} bind:clientHeight={mainHeight}>
    {#if snapshot.tiles.length === 0}
      <div class="empty">
        <p>{t('app.empty.noSessions')}</p>
        <p class="hint"><WithCode text={t('app.empty.noSessionsHint')} codes={{ code: 'claude' }} /></p>
      </div>
    {:else if shownTiles.length === 0}
      <div class="empty">
        <p>{t('app.empty.noMatch')}</p>
        <p class="hint"><button class="link" onclick={() => (filters = [])}>{t('app.empty.showAll')}</button></p>
      </div>
    {:else}
      <div class="blocks" style:gap="{viewMode === 'list' ? ROW_GAP : GAP}px">
        {#each visibleBlocks as block, b (b)}
          <section class="block">
            {#if block.title !== null}<h3 class="group-title">{block.title}</h3>{/if}
            <div
              class="grid {viewMode}"
              style:--scale={scale}
              style:grid-template-columns={viewMode === 'tiles' ? `repeat(${columns}, minmax(0, 1fr))` : null}
            >
              {#each block.items as { tile, index } (tile.sessionId)}
                <Tile
                  {tile}
                  {now}
                  {index}
                  selected={tile.sessionId === selectedId}
                  variant={viewMode === 'list' ? 'row' : 'card'}
                  contextWarnPct={settings?.contextWarnPct ?? 80}
                  fiveHourResetsAt={snapshot.header.fiveHour?.resetsAt ?? null}
                  onDragStart={(id) => (dragId = id)}
                  {onDropOn}
                  onAnswer={openAnswer}
                />
              {/each}
            </div>
          </section>
        {/each}
      </div>
      {#if pages > 1}
        <nav class="pager" aria-label={t('app.pager.label')}>
          <button disabled={page === 0} onclick={() => (page = page - 1)} aria-label={t('app.pager.previous')}>‹</button>
          {#each Array.from({ length: pages }, (_, i) => i) as i (i)}
            <button
              class="dot"
              class:active={i === page}
              class:waiting={(pageBlocks[i] ?? []).some((block) =>
                block.items.some(({ tile }) => NEEDS_YOU.includes(tile.state)),
              )}
              onclick={() => (page = i)}
              aria-label={t('app.pager.page', { page: i + 1 })}
            ></button>
          {/each}
          <button disabled={page === pages - 1} onclick={() => (page = page + 1)} aria-label={t('app.pager.next')}>›</button>
          <span class="count">{t('app.pager.count', { page: page + 1, pages })}</span>
        </nav>
      {/if}
    {/if}
  </main>
</div>

{#if showSettings && settingsView}
  <Settings
    view={settingsView}
    onChange={(next) => (settingsView = next)}
    onClose={() => (showSettings = false)}
    onDoctor={() => (showDoctor = true)}
    onTour={startTour}
  />
{/if}

{#if touring}
  <Tour
    hooksInstalled={settingsView?.integration.hooksInstalled ?? false}
    {installing}
    onInstall={() => void installFromTour()}
    onDone={() => void finishTour()}
  />
{/if}

{#if showDoctor}
  <Doctor onClose={() => (showDoctor = false)} />
{/if}

{#if answering?.pending?.questions}
  {#key answering.pending.id}
    <QuestionDialog
      id={answering.pending.id}
      session={answering.name}
      questions={answering.pending.questions}
      onClose={() => (answeringKey = null)}
    />
  {/key}
{/if}
{#if answering?.pending && !answering.pending.questions}
  {#key answering.pending.id}
    <ReviewDialog
      pending={answering.pending}
      sessionId={answering.sessionId}
      session={answering.name}
      onClose={() => (answeringKey = null)}
    />
  {/key}
{/if}

{#if showNewSession}
  <NewSession {now} onClose={() => (showNewSession = false)} />
{/if}

{#if showToday}
  <Stats today={snapshot.header.today} onClose={() => (showToday = false)} />
{/if}

{#if settingsView?.askHooks && !touring}
  <div class="modal-backdrop">
    <div class="modal">
      <h2>{t('app.hookPrompt.title')}</h2>
      <p><WithCode text={t('app.hookPrompt.body')} codes={{ code: '~/.claude/settings.json' }} /></p>
      <p class="hint">{t('app.hookPrompt.hint')}</p>
      <div class="modal-buttons">
        <button class="secondary" disabled={installing} onclick={() => closeHookPrompt(true)}>{t('app.hookPrompt.never')}</button>
        <button class="secondary" disabled={installing} onclick={() => closeHookPrompt(false)}>{t('app.hookPrompt.notNow')}</button>
        <button class="primary" disabled={installing} onclick={installFromPrompt}>
          {installing ? t('app.hookPrompt.installing') : t('app.hookPrompt.install')}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  main {
    position: relative;
    flex: 1;
    overflow: hidden;
    padding: 14px 16px 24px;
    min-height: 0;
  }

  .blocks {
    display: flex;
    flex-direction: column;
  }

  .group-title {
    height: 22px;
    margin: 0 0 6px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 700;
    line-height: 22px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid var(--border);
  }

  .link {
    padding: 0;
    background: none;
    border: none;
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
  }

  .grid.tiles {
    display: grid;
    gap: 12px;
    align-content: start;
  }

  .pager {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .pager button {
    background: none;
    border: none;
    color: var(--muted);
    font-size: 18px;
    line-height: 1;
    padding: 2px 6px;
  }

  .pager button:disabled {
    opacity: 0.3;
  }

  .pager .dot {
    width: 9px;
    height: 9px;
    padding: 0;
    border-radius: 50%;
    background: var(--border);
  }

  .pager .dot.active {
    background: var(--accent);
  }

  .pager .dot.waiting:not(.active) {
    background: var(--st-needsApproval);
  }

  .pager .count {
    margin-left: 6px;
    color: var(--muted);
    font-size: 11px;
  }

  .grid.list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .empty {
    display: grid;
    place-content: center;
    height: 100%;
    text-align: center;
    color: var(--muted);
  }

  .empty p {
    margin: 4px 0;
    font-size: 15px;
  }

  .hint {
    font-size: 12px;
    color: var(--muted);
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0.5);
  }

  .modal {
    width: min(520px, calc(100% - 32px));
    padding: 20px 22px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--shadow);
  }

  .modal h2 {
    margin: 0 0 10px;
    font-size: 18px;
  }

  .modal p {
    line-height: 1.5;
  }

  .modal-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }

  .modal-buttons button {
    padding: 7px 14px;
    border-radius: 6px;
    border: 1px solid var(--border);
  }

  .primary {
    background: var(--accent);
    border-color: var(--accent) !important;
    color: #fff;
    font-weight: 600;
  }

  .secondary {
    background: var(--surface-2);
  }
</style>
