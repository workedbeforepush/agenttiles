<script lang="ts">
  import type { KeyAction, KeyBinding, TileView } from '../../../core/types';
  import { displayCombo } from '../keys';
  import { prettyInput, since, stateColor } from '../format';


  interface Props {
    waiting: { tile: TileView; index: number }[];
    now: number;
    keys: Record<KeyAction, KeyBinding> | null;
    onAnswer: (sessionId: string) => void;
  }

  let { waiting, now, keys, onAnswer }: Props = $props();

  /** Hint for the enabled shortcuts that matter here. */
  const hint = $derived.by(() => {
    if (!keys) return '';
    const parts: string[] = [];
    if (keys.selectTile.enabled) parts.push('1–9 select');
    if (keys.deny.enabled) parts.push(`${displayCombo(keys.deny.key)} deny`);
    if (keys.jump.enabled) parts.push(`${displayCombo(keys.jump.key)} jump`);
    return parts.join(' · ');
  });

  function decide(event: MouseEvent, tile: TileView, decision: 'allow' | 'deny', always = false): void {
    event.stopPropagation();
    if (tile.pending) void window.ccdash.decidePermission(tile.pending.id, { decision, always });
  }
</script>

<section class="banner" aria-label="Sessions waiting for you">
  <span class="title">Needs you</span>
  <div class="items">
    {#each waiting as { tile, index } (tile.sessionId)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="item"
        style:--c={stateColor(tile.state)}
        role="button"
        tabindex="0"
        onclick={() => void window.ccdash.tileAction(tile.sessionId, 'focus')}
        title="Jump to terminal"
      >
        {#if index <= 9}<span class="key">{index}</span>{/if}
        <span class="label">{tile.stateLabel}</span>
        <span class="name">{tile.name}</span>
        <!-- Questions and plans say what they are about in the activity; tool requests in their summary. -->
        <span class="what">
          {(tile.pending?.questions || tile.pending?.plan != null ? tile.activity : tile.pending?.summary) ?? tile.activity ?? ''}
        </span>
        <span class="since">{since(tile.stateSince, now)}</span>
        {#if tile.pending?.questions || tile.pending?.plan != null || tile.pending?.diff}
          <button
            class="answer"
            onclick={(e) => {
              e.stopPropagation();
              onAnswer(tile.sessionId);
            }}
          >
            {tile.pending?.questions ? 'Answer…' : 'Review…'}
          </button>
        {/if}
        {#if tile.pending && !tile.pending.questions && tile.pending.plan === null}
          <button class="allow" onclick={(e) => decide(e, tile, 'allow')} title={prettyInput(tile.pending.toolInput)}>
            Allow
          </button>
          {#if tile.pending.alwaysLabel}
            <button class="always" onclick={(e) => decide(e, tile, 'allow', true)} title={tile.pending.alwaysLabel}>
              Always
            </button>
          {/if}
          <button class="deny" onclick={(e) => decide(e, tile, 'deny')} title="Deny">Deny</button>
        {/if}
      </div>
    {/each}
  </div>
  {#if hint}<span class="keys">{hint}</span>{/if}
</section>

<style>
  .banner {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 8px 16px;
    background: color-mix(in srgb, var(--st-needsApproval) 14%, var(--surface));
    border-bottom: 1px solid color-mix(in srgb, var(--st-needsApproval) 40%, var(--border));
  }

  .title {
    padding-top: 5px;
    color: var(--st-needsApproval);
    font-weight: 700;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }

  .items {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 3px 8px;
    border-radius: 6px;
    cursor: pointer;
    min-width: 0;
  }

  .item:hover {
    background: color-mix(in srgb, var(--c) 12%, transparent);
  }

  .key {
    display: grid;
    place-items: center;
    min-width: 20px;
    height: 20px;
    border-radius: 4px;
    background: var(--surface-2);
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
  }

  .label {
    color: var(--c);
    font-weight: 700;
    font-size: 11px;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .name {
    font-weight: 600;
    white-space: nowrap;
  }

  .what {
    flex: 1;
    min-width: 0;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .since {
    color: var(--muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  button {
    padding: 3px 12px;
    border: none;
    border-radius: 5px;
    font-weight: 600;
    color: #fff;
  }

  .allow {
    background: var(--st-done);
  }

  .deny {
    background: var(--st-error);
  }

  .always {
    background: color-mix(in srgb, var(--st-done) 65%, var(--surface-2));
  }

  .answer {
    background: var(--st-needsInput);
  }

  .keys {
    padding-top: 5px;
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
  }
</style>
