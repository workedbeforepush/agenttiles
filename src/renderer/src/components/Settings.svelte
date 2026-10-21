<script lang="ts">
  import type { KeyAction, LogLevel, Settings, SettingsPatch, SettingsView, SoundState, ThemeSetting, TileSize } from '../../../core/types';
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
  }

  let { view, onChange, onClose, onDoctor }: Props = $props();
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
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onClose}>
  <div class="panel" onclick={(e) => e.stopPropagation()}>
    {#if saveError}<p class="error">Could not save: {saveError}</p>{/if}
    <div class="head">
      <h2>Settings</h2>
      <button class="close" onclick={onClose} aria-label="Close">✕</button>
    </div>

    <section>
      <h3>Claude Code integration</h3>
      <label class="row">
        <input
          type="checkbox"
          checked={i.hooksInstalled}
          disabled={busy}
          onchange={(e) => run(() => window.agenttiles.setHooks((e.currentTarget as HTMLInputElement).checked))}
        />
        <span>Hooks <small>live tool activity, Allow / Deny from tiles. Running sessions pick them up when Claude Code reloads its settings.</small></span>
      </label>
      <label class="row">
        <input
          type="checkbox"
          checked={i.statuslineInstalled}
          disabled={busy}
          onchange={(e) => run(() => window.agenttiles.setStatusline((e.currentTarget as HTMLInputElement).checked))}
        />
        <span>Statusline wrapper <small>cost, context and rate limits. An existing statusline keeps working.</small></span>
      </label>
      {#if i.nodePath}<p class="hint">Node.js: {i.nodePath}</p>{/if}
      {#if i.error}<p class="error">{i.error}</p>{/if}
    </section>

    <section>
      <h3>Window</h3>
      <label class="row"><input type="checkbox" checked={s.alwaysOnTop} onchange={checkbox('alwaysOnTop')} /> Always on top</label>
      <label class="row">
        Theme
        <select value={s.theme} onchange={(e) => update({ theme: (e.currentTarget as HTMLSelectElement).value as ThemeSetting })}>
          <option value="system">System</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </label>
      <label class="row">
        <input type="checkbox" checked={s.autostart} onchange={checkbox('autostart')} />
        Start with system login
      </label>
    </section>

    <section>
      <h3>Keyboard</h3>
      <p class="hint">Click a field and press the new key. Shortcuts work while the AgentTiles window has the focus.</p>
      <div class="keys">
        <div class="key-row">
          <label class="row">
            <input type="checkbox" checked={s.hotkeyEnabled} onchange={checkbox('hotkeyEnabled')} />
            <span>Show / hide AgentTiles <small>global, works in every app</small></span>
          </label>
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
        {#each KEY_LABELS as { action, label } (action)}
          <div class="key-row" class:conflict={conflicts.has(action)}>
            <label class="row">
              <input
                type="checkbox"
                checked={s.keys[action].enabled}
                onchange={(e) => toggleKey(action, (e.currentTarget as HTMLInputElement).checked)}
              />
              <span>{label}{#if conflicts.has(action)} <small class="conflict-note">used twice</small>{/if}</span>
            </label>
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
      </div>
      <p class="hint">Fixed: Esc closes dialogs; the question dialog uses ↑ ↓ 1–9 Space Enter like the terminal.</p>
    </section>

    <section>
      <h3>Display</h3>
      <label class="row">
        Tile size
        <select value={s.tileSize} onchange={(e) => update({ tileSize: (e.currentTarget as HTMLSelectElement).value as TileSize })}>
          <option value="S">Small</option>
          <option value="M">Medium</option>
          <option value="L">Large</option>
        </select>
        <small>All tiles share one size; more sessions than fit go to further pages.</small>
      </label>
      <label class="row">
        <input type="checkbox" checked={s.reduceMotion} onchange={checkbox('reduceMotion')} /> Reduce motion
        <small>no blinking or pulsing; the OS setting is respected as well</small>
      </label>
    </section>

    <section>
      <h3>Notifications</h3>
      <label class="row"><input type="checkbox" checked={s.toasts} onchange={checkbox('toasts')} /> Toasts when a session needs you, finishes or fails</label>
      <div class="sounds">
        <span class="sub">Sound per state <small>played by AgentTiles, also while its window is focused</small></span>
        <label class="row volume">
          Volume
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
        </label>
        {#each SOUND_PRIORITY as state (state)}
          <div class="sound-row">
            <label class="row">
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
      <label class="row">
        Remind me every
        <input
          class="num"
          type="number"
          min="0"
          max="120"
          value={s.reminderMin}
          onchange={(e) => numberSetting(e, 'reminderMin', 0, 120)}
        />
        minutes while a session waits <small class="inline-hint">0 = off</small>
      </label>
      <label class="row">
        Warn when the context window is
        <input
          class="num"
          type="number"
          min="0"
          max="99"
          value={s.contextWarnPct}
          onchange={(e) => numberSetting(e, 'contextWarnPct', 0, 99)}
        />
        % full <small class="inline-hint">0 = off</small>
      </label>
    </section>

    <section>
      <h3>Permissions</h3>
      <label class="row">
        Hold Allow / Deny on the tile for
        <input class="num" type="number" min="10" max="3600" value={s.permissionTimeoutSec} onchange={onTimeout} />
        seconds
      </label>
    </section>

    <section>
      <h3>Logging</h3>
      <label class="row">
        Level
        <select value={s.logLevel} onchange={(e) => update({ logLevel: (e.currentTarget as HTMLSelectElement).value as LogLevel })}>
          <option value="error">error</option>
          <option value="warn">warn</option>
          <option value="info">info</option>
          <option value="debug">debug</option>
        </select>
      </label>
    </section>

    <section>
      <h3>Hidden</h3>
      {#if view.hiddenSessions.length === 0 && view.hiddenProjects.length === 0}
        <p class="hint">Nothing hidden. Right-click a tile to hide a session or a project.</p>
      {/if}
      {#each view.hiddenSessions as hidden (hidden.sessionId)}
        <div class="hidden-row">
          <span>Session: {hidden.name}</span>
          <button onclick={() => run(() => window.agenttiles.unhideSession(hidden.sessionId))}>Show</button>
        </div>
      {/each}
      {#each view.hiddenProjects as path (path)}
        <div class="hidden-row">
          <span title={path}>Project: {path}</span>
          <button onclick={() => run(() => window.agenttiles.unhideProject(path))}>Show</button>
        </div>
      {/each}
    </section>

    <section class="about">
      <button class="secondary" onclick={onDoctor}>Open diagnostics</button>
      <span class="version">AgentTiles {view.version}</span>
    </section>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    justify-content: flex-end;
    background: rgb(0 0 0 / 0.35);
  }

  .panel {
    width: min(460px, 100%);
    height: 100%;
    overflow: auto;
    padding: 16px 20px;
    background: var(--surface);
    border-left: 1px solid var(--border);
    box-shadow: var(--shadow);
    user-select: text;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h2 {
    margin: 0;
    font-size: 18px;
  }

  h3 {
    margin: 0 0 8px;
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

  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 4px 0;
  }

  .row small {
    display: block;
    color: var(--muted);
  }

  /* Long descriptions wrap inside their text column, next to the checkbox. */
  .row > span {
    flex: 1;
    min-width: 0;
  }

  .hint {
    margin: 6px 0 0;
    color: var(--muted);
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  .error {
    margin: 6px 0 0;
    color: var(--st-error);
  }

  .num {
    width: 80px;
  }


  .close,
  .hidden-row button,
  .secondary {
    padding: 4px 10px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  .sounds {
    margin-top: 6px;
  }

  .sub small {
    display: block;
    color: var(--muted);
  }

  .volume input {
    flex: 1;
    padding: 0;
    accent-color: var(--accent);
  }

  .volume-value {
    flex: 0 0 auto !important;
    min-width: 3em;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .key-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .key-row .row {
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

  .conflict-note {
    display: inline !important;
    color: var(--st-error) !important;
  }

  .about {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .version {
    color: var(--muted);
    font-size: 12px;
  }

  .inline-hint {
    color: var(--muted);
    font-size: 11px;
  }

  .sound-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-left: 4px;
  }

  .play {
    padding: 2px 9px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 11px;
  }

  .hidden-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 0;
  }

  .hidden-row span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
