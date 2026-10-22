<script module lang="ts">
  type Page = 'general' | 'notifications' | 'keyboard' | 'claude' | 'hidden' | 'advanced';
  /** The page shown last; Settings opens there again while the app runs. */
  let lastPage: Page = 'general';
</script>

<script lang="ts">
  import type { KeyAction, LogLevel, SettingsPatch, SettingsView, SoundState, ThemeSetting, TileSize } from '../../../core/types';
  import { SOUND_PRIORITY, playCue } from '../sounds';
  import { acceleratorOf, comboOf, displayCombo, hasModifier } from '../keys';

  const KEY_LABELS: { action: KeyAction; label: string }[] = [
    { action: 'selectTile', label: 'Select tile' },
    { action: 'jump', label: 'Jump to terminal / answer question' },
    { action: 'deny', label: 'Deny the waiting request' },
    { action: 'escape', label: 'Clear selection / leave full screen' },
    { action: 'fullscreen', label: 'Full screen' },
    { action: 'nextPage', label: 'Next page' },
    { action: 'prevPage', label: 'Previous page' },
  ];

  /** Which field records the next key press: an action or the global hotkey. */
  let recording = $state<KeyAction | 'global' | null>(null);

  function record(event: KeyboardEvent, target: KeyAction | 'global'): void {
    if (event.key === 'Tab') return; // keep keyboard navigation through the form
    event.preventDefault();
    event.stopPropagation();
    const combo = comboOf(event);
    if (!combo) return;
    globalHint = target === 'global' && !hasModifier(combo);
    if (globalHint) return;
    recording = null;
    (event.currentTarget as HTMLElement).blur();
    if (target === 'global') update({ hotkey: acceleratorOf(combo) });
    else update({ keys: { [target]: { ...s.keys[target], key: combo } } });
  }

  /** Shown while recording the global hotkey without a modifier. */
  let globalHint = $state(false);

  function toggleKey(action: KeyAction, enabled: boolean): void {
    update({ keys: { [action]: { ...s.keys[action], enabled } } });
  }

  /** Enabled shortcuts that share a key with another one (1–9 count while tile selection is on). */
  const conflicts = $derived.by(() => {
    const keys = view.settings.keys;
    const used = new Map<string, KeyAction[]>();
    for (const { action } of KEY_LABELS) {
      if (action === 'selectTile' || !keys[action].enabled) continue;
      used.set(keys[action].key, [...(used.get(keys[action].key) ?? []), action]);
    }
    const result = new Set<KeyAction>();
    for (const [key, actions] of used) {
      if (actions.length > 1 || (keys.selectTile.enabled && /^[1-9]$/.test(key))) actions.forEach((a) => result.add(a));
    }
    return result;
  });

  const SOUND_LABELS: Record<SoundState, string> = {
    needsApproval: 'Needs approval',
    needsInput: 'Question',
    limitHit: 'Rate limit reached',
    contextFull: 'Context window filling up',
    error: 'Error',
    done: 'Ready (turn finished)',
  };

  interface Props {
    view: SettingsView;
    onChange: (view: SettingsView) => void;
    onClose: () => void;
    onDoctor: () => void;
    onTour: () => void;
  }

  let { view, onChange, onClose, onDoctor, onTour }: Props = $props();
  let busy = $state(false);

  let saveError = $state<string | null>(null);

  async function run(action: () => Promise<SettingsView>): Promise<void> {
    busy = true;
    saveError = null;
    try {
      onChange(await action());
    } catch (error) {
      saveError = (error as Error).message;
    } finally {
      busy = false;
    }
  }

  function numberSetting(event: Event, key: 'reminderMin' | 'contextWarnPct', min: number, max: number): void {
    const input = event.currentTarget as HTMLInputElement;
    const value = Number(input.value);
    if (Number.isInteger(value) && value >= min && value <= max) update({ [key]: value });
    else input.value = String(s[key]); // not saved: show what is in effect
  }

  function update(patch: SettingsPatch): void {
    // Settings values are reactive proxies; IPC can only send plain data.
    const plain = $state.snapshot(patch) as SettingsPatch;
    void run(() => window.agenttiles.updateSettings(plain));
  }

  function checkbox(
    key: 'alwaysOnTop' | 'toasts' | 'autostart' | 'hotkeyEnabled' | 'reduceMotion',
  ) {
    return (event: Event): void => update({ [key]: (event.currentTarget as HTMLInputElement).checked });
  }

  function toggleSound(state: SoundState, on: boolean): void {
    update({ sounds: { [state]: on } });
  }

  function onTimeout(event: Event): void {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (Number.isInteger(value) && value >= 10 && value <= 3600) update({ permissionTimeoutSec: value });
  }

  const s = $derived(view.settings);
  const i = $derived(view.integration);

  const PAGES: { id: Page; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'keyboard', label: 'Keyboard' },
    { id: 'claude', label: 'Claude Code' },
    { id: 'hidden', label: 'Hidden' },
    { id: 'advanced', label: 'Advanced' },
  ];
  let page = $state<Page>(lastPage);

  function show(next: Page): void {
    page = next;
    lastPage = next;
  }

  const hiddenCount = $derived(view.hiddenSessions.length + view.hiddenProjects.length);
</script>

{#snippet toggle(checked: boolean, onchange: (event: Event) => void, label: string, hint: string = '', disabled: boolean = false)}
  <label class="switch-row">
    <span class="text">{label}{#if hint}<small>{hint}</small>{/if}</span>
    <input class="switch" type="checkbox" role="switch" {checked} {disabled} {onchange} />
  </label>
{/snippet}

{#snippet segment(options: [string, string][], value: string, pick: (value: string) => void)}
  <div class="segment" role="radiogroup">
    {#each options as [option, text] (option)}
      <button role="radio" aria-checked={option === value} class:active={option === value} onclick={() => pick(option)}>{text}</button>
    {/each}
  </div>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onClose}>
  <div class="panel" onclick={(e) => e.stopPropagation()}>
    <div class="head">
      <h2>Settings</h2>
      <button class="tour" onclick={onTour}>✨ Replay the tour</button>
      <button class="close" onclick={onClose} aria-label="Close">✕</button>
    </div>

    <div class="body">
      <nav aria-label="Settings pages">
        {#each PAGES as p (p.id)}
          <button class:active={page === p.id} aria-current={page === p.id ? 'page' : undefined} onclick={() => show(p.id)}>
            {p.label}
            {#if p.id === 'hidden' && hiddenCount > 0}<span class="badge">{hiddenCount}</span>{/if}
            {#if p.id === 'claude' && !i.hooksInstalled}<span class="badge warn" title="Hooks not installed">!</span>{/if}
          </button>
        {/each}
        <span class="version">AgentTiles {view.version}</span>
      </nav>

      <div class="page">
        {#if saveError}<p class="error">Could not save: {saveError}</p>{/if}

        {#if page === 'general'}
          <section>
            <h3>Appearance</h3>
            <div class="field">
              <span class="text">Theme</span>
              {@render segment(
                [['system', 'System'], ['dark', 'Dark'], ['light', 'Light']],
                s.theme,
                (theme) => update({ theme: theme as ThemeSetting }),
              )}
            </div>
            <div class="field">
              <span class="text">Tile size<small>All tiles share one size; more sessions than fit go to further pages.</small></span>
              {@render segment([['S', 'S'], ['M', 'M'], ['L', 'L']], s.tileSize, (size) => update({ tileSize: size as TileSize }))}
            </div>
            {@render toggle(s.reduceMotion, checkbox('reduceMotion'), 'Reduce motion', 'No blinking or pulsing; the OS setting is respected as well.')}
          </section>
          <section>
            <h3>Window</h3>
            {@render toggle(s.alwaysOnTop, checkbox('alwaysOnTop'), 'Always on top')}
            {@render toggle(s.autostart, checkbox('autostart'), 'Start with system login')}
          </section>
        {:else if page === 'notifications'}
          <section>
            <h3>Toasts</h3>
            {@render toggle(s.toasts, checkbox('toasts'), 'Show a toast', 'When a session needs you, finishes or fails.')}
          </section>
          <section>
            <h3>Sounds</h3>
            <p class="hint">Played by AgentTiles, also while its window is focused.</p>
            <label class="field">
              <span class="text">Volume</span>
              <span class="volume">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={s.soundVolume}
                  onchange={(e) => {
                    const volume = Number((e.currentTarget as HTMLInputElement).value);
                    update({ soundVolume: volume });
                    playCue('needsApproval', volume);
                  }}
                />
                <span class="volume-value">{s.soundVolume}%</span>
              </span>
            </label>
            <div class="sounds">
              {#each SOUND_PRIORITY as state (state)}
                <div class="sound" class:on={s.sounds[state]}>
                  <label>
                    <input
                      type="checkbox"
                      checked={s.sounds[state]}
                      onchange={(e) => toggleSound(state, (e.currentTarget as HTMLInputElement).checked)}
                    />
                    {SOUND_LABELS[state]}
                  </label>
                  <button class="play" onclick={() => playCue(state, s.soundVolume)} title="Play" aria-label="Play {SOUND_LABELS[state]}">▶</button>
                </div>
              {/each}
            </div>
          </section>
          <section>
            <h3>Reminders</h3>
            <label class="field">
              <span class="text">Remind every … minutes while a session waits<small>0 = off</small></span>
              <input class="num" type="number" min="0" max="120" value={s.reminderMin} onchange={(e) => numberSetting(e, 'reminderMin', 0, 120)} />
            </label>
            <label class="field">
              <span class="text">Warn when the context window is … % full<small>0 = off</small></span>
              <input class="num" type="number" min="0" max="99" value={s.contextWarnPct} onchange={(e) => numberSetting(e, 'contextWarnPct', 0, 99)} />
            </label>
          </section>
        {:else if page === 'keyboard'}
          <section>
            <h3>Global</h3>
            <div class="key-row">
              {@render toggle(s.hotkeyEnabled, checkbox('hotkeyEnabled'), 'Show / hide AgentTiles', 'Works in every app.')}
              <input
                class="recorder"
                class:recording={recording === 'global'}
                readonly
                value={recording === 'global' ? 'Press keys…' : displayCombo(s.hotkey)}
                onfocus={() => (recording = 'global')}
                onblur={() => {
                  recording = null;
                  globalHint = false;
                }}
                onkeydown={(e) => record(e, 'global')}
              />
            </div>
            {#if globalHint}<p class="hint conflict-note">The global hotkey needs Ctrl, Alt, Shift or Meta.</p>{/if}
          </section>
          <section>
            <h3>In the window</h3>
            <p class="hint">Click a field and press the new key.</p>
            {#each KEY_LABELS as { action, label } (action)}
              <div class="key-row" class:conflict={conflicts.has(action)}>
                {@render toggle(
                  s.keys[action].enabled,
                  (e) => toggleKey(action, (e.currentTarget as HTMLInputElement).checked),
                  label,
                  conflicts.has(action) ? 'Used twice' : '',
                )}
                {#if action === 'selectTile'}
                  <input class="recorder" readonly value="1 – 9" disabled />
                {:else}
                  <input
                    class="recorder"
                    class:recording={recording === action}
                    readonly
                    disabled={!s.keys[action].enabled}
                    value={recording === action ? 'Press keys…' : displayCombo(s.keys[action].key)}
                    onfocus={() => (recording = action)}
                    onblur={() => (recording = null)}
                    onkeydown={(e) => record(e, action)}
                  />
                {/if}
              </div>
            {/each}
            <p class="hint">Fixed: Esc closes dialogs; the question dialog uses ↑ ↓ 1–9 Space Enter like the terminal.</p>
          </section>
        {:else if page === 'claude'}
          <section>
            <h3>Integration</h3>
            <p class="hint">Entries in <code>~/.claude/settings.json</code>. Your own hooks and statusline keep working.</p>
            {@render toggle(
              i.hooksInstalled,
              (e) => void run(() => window.agenttiles.setHooks((e.currentTarget as HTMLInputElement).checked)),
              'Hooks',
              'Live tool activity, Allow / Deny from tiles. Running sessions pick them up when Claude Code reloads its settings.',
              busy,
            )}
            {@render toggle(
              i.statuslineInstalled,
              (e) => void run(() => window.agenttiles.setStatusline((e.currentTarget as HTMLInputElement).checked)),
              'Statusline wrapper',
              'Cost, context and rate limits. An existing statusline keeps working.',
              busy,
            )}
            {#if i.nodePath}<p class="hint">Node.js: {i.nodePath}</p>{/if}
            {#if i.error}<p class="error">{i.error}</p>{/if}
          </section>
        {:else if page === 'hidden'}
          <section>
            <h3>Hidden sessions and projects</h3>
            {#if hiddenCount === 0}
              <p class="hint">Nothing hidden. Right-click a tile to hide a session or a project.</p>
            {/if}
            {#each view.hiddenSessions as hidden (hidden.sessionId)}
              <div class="hidden-row">
                <span>Session: {hidden.name}</span>
                <button class="secondary" onclick={() => run(() => window.agenttiles.unhideSession(hidden.sessionId))}>Show</button>
              </div>
            {/each}
            {#each view.hiddenProjects as path (path)}
              <div class="hidden-row">
                <span title={path}>Project: {path}</span>
                <button class="secondary" onclick={() => run(() => window.agenttiles.unhideProject(path))}>Show</button>
              </div>
            {/each}
          </section>
        {:else}
          <section>
            <h3>Permissions</h3>
            <label class="field">
              <span class="text">Hold Allow / Deny on the tile for … seconds<small>Then the terminal decides alone.</small></span>
              <input class="num" type="number" min="10" max="3600" value={s.permissionTimeoutSec} onchange={onTimeout} />
            </label>
          </section>
          <section>
            <h3>Logging</h3>
            <div class="field">
              <span class="text">Level</span>
              {@render segment(
                [['error', 'error'], ['warn', 'warn'], ['info', 'info'], ['debug', 'debug']],
                s.logLevel,
                (level) => update({ logLevel: level as LogLevel }),
              )}
            </div>
          </section>
          <section>
            <h3>Diagnostics</h3>
            <p class="hint">Compares the session registry, <code>claude agents</code> and what AgentTiles shows.</p>
            <button class="secondary" onclick={onDoctor}>Open diagnostics</button>
          </section>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0.4);
  }

  .panel {
    display: flex;
    flex-direction: column;
    width: min(760px, calc(100% - 32px));
    height: min(560px, calc(100% - 48px));
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--shadow);
    user-select: text;
    overflow: hidden;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
  }

  h2 {
    margin: 0;
    font-size: 18px;
  }

  .tour {
    margin-left: auto;
    padding: 4px 10px;
    background: var(--surface-2);
    border: 1px solid var(--accent);
    border-radius: 6px;
    color: var(--text);
    font-size: 12px;
  }

  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 170px;
    flex-shrink: 0;
    padding: 12px 8px;
    background: var(--surface-2);
    border-right: 1px solid var(--border);
  }

  nav button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 10px;
    background: none;
    border: none;
    border-radius: 6px;
    color: var(--muted);
    text-align: left;
  }

  nav button:hover {
    color: var(--text);
  }

  nav button.active {
    background: var(--surface);
    color: var(--text);
    font-weight: 600;
  }

  .badge {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--border);
    color: var(--text);
    font-size: 11px;
    font-weight: 600;
    text-align: center;
  }

  .badge.warn {
    background: var(--st-needsApproval);
    color: #000;
  }

  .version {
    margin-top: auto;
    padding: 0 10px;
    color: var(--muted);
    font-size: 11px;
  }

  .page {
    flex: 1;
    min-width: 0;
    overflow: auto;
    padding: 4px 20px 16px;
  }

  h3 {
    margin: 0 0 6px;
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  section {
    padding: 14px 0;
    border-bottom: 1px solid var(--border);
  }

  section:last-child {
    border-bottom: none;
  }

  .switch-row,
  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 7px 0;
  }

  .switch-row {
    cursor: pointer;
  }

  .text {
    flex: 1;
    min-width: 0;
  }

  .text small {
    display: block;
    margin-top: 2px;
    color: var(--muted);
    font-size: 12px;
  }

  /* A checkbox drawn as a switch: the knob is the ::before of the track. */
  .switch {
    appearance: none;
    position: relative;
    flex-shrink: 0;
    width: 34px;
    height: 20px;
    margin: 0;
    padding: 0;
    background: var(--border);
    border: none;
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .switch::before {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 14px;
    height: 14px;
    background: #fff;
    border-radius: 50%;
    transition: transform 0.15s ease;
  }

  .switch:checked {
    background: var(--accent);
  }

  .switch:checked::before {
    transform: translateX(14px);
  }

  .switch:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .switch:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .segment {
    display: flex;
    flex-shrink: 0;
    gap: 2px;
    padding: 2px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 7px;
  }

  .segment button {
    min-width: 34px;
    padding: 3px 10px;
    background: none;
    border: none;
    border-radius: 5px;
    color: var(--muted);
    font-size: 12px;
  }

  .segment button.active {
    background: var(--accent);
    color: #fff;
    font-weight: 600;
  }

  .hint {
    margin: 0 0 4px;
    color: var(--muted);
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  .error {
    margin: 10px 0 0;
    color: var(--st-error);
  }

  .num {
    width: 72px;
    flex-shrink: 0;
  }

  .close,
  .secondary {
    padding: 4px 10px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  .volume {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 220px;
  }

  .volume input {
    flex: 1;
    padding: 0;
    accent-color: var(--accent);
  }

  .volume-value {
    min-width: 3em;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .sounds {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    margin-top: 6px;
  }

  .sound {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 5px 6px 5px 8px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--muted);
    font-size: 12px;
  }

  .sound.on {
    border-color: var(--accent);
    color: var(--text);
  }

  .sound label {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    cursor: pointer;
  }

  .sound input {
    accent-color: var(--accent);
  }

  .play {
    padding: 1px 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 10px;
  }

  .key-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .key-row .switch-row {
    flex: 1;
    min-width: 0;
  }

  .recorder {
    width: 130px;
    flex-shrink: 0;
    text-align: center;
    cursor: pointer;
    font-family: var(--mono);
    font-size: 12px;
  }

  .recorder.recording {
    border-color: var(--accent);
    color: var(--accent);
  }

  .recorder:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .key-row.conflict .recorder {
    border-color: var(--st-error);
  }

  .key-row.conflict small,
  .conflict-note {
    color: var(--st-error) !important;
  }

  .hidden-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 0;
  }

  .hidden-row span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
