<script lang="ts">
  import type { UpdateView } from '../../../core/types';
  import { t } from '../i18n.svelte';

  interface Props {
    update: UpdateView;
  }

  let { update }: Props = $props();

  /** A failed update has no version to dismiss: ✕ hides it until the next start. */
  let failedHidden = $state(false);

  const failed = $derived(update.failed !== null && !failedHidden);
  const shown = $derived(failed || (update.available !== null && !update.dismissed));

  function dismiss(event: MouseEvent): void {
    event.stopPropagation();
    if (failed) failedHidden = true;
    else void window.agenttiles.dismissUpdate();
  }

  function notes(event: MouseEvent): void {
    event.stopPropagation();
    void window.agenttiles.openReleaseNotes();
  }
</script>

{#if shown}
  <div class="note" class:failed role="status">
    <button onclick={() => void window.agenttiles.runUpdate()}>
      {failed ? t('app.update.failed') : t('app.update.available', { version: update.available ?? '' })}
    </button>
    {#if update.available}
      <span>·</span>
      <button onclick={notes}>{t('app.update.whatsNew')}</button>
    {/if}
    <button class="close" onclick={dismiss} aria-label={t('app.update.dismiss')} title={t('app.update.dismiss')}>✕</button>
  </div>
{/if}

<style>
  .note {
    position: fixed;
    right: 16px;
    bottom: 10px;
    z-index: 90;
    display: flex;
    align-items: baseline;
    gap: 6px;
    color: var(--st-limitHit);
    font-size: 12px;
    font-weight: 600;
  }

  .note.failed {
    color: var(--st-error);
  }

  button {
    padding: 0;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  button:hover {
    text-decoration: underline;
  }

  .close {
    margin-left: 4px;
    opacity: 0.7;
  }

  .close:hover {
    text-decoration: none;
    opacity: 1;
  }
</style>
