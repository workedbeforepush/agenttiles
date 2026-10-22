<script lang="ts">
  import { onMount } from 'svelte';
  import type { DecisionRequest, PendingPermission } from '../../../core/types';
  import { markdownHtml } from '../markdown';
  import DiffLines from './DiffLines.svelte';
  import { t } from '../i18n.svelte';

  interface Props {
    pending: PendingPermission;
    sessionId: string;
    session: string;
    onClose: () => void;
  }

  let { pending, sessionId, session, onClose }: Props = $props();

  let feedback = $state('');
  let sending = $state(false);
  let failed = $state(false);

  const isPlan = $derived(pending.plan !== null);
  const color = $derived(isPlan ? 'var(--st-needsInput)' : 'var(--st-needsApproval)');

  async function send(request: DecisionRequest): Promise<void> {
    if (sending) return;
    sending = true;
    try {
      if (await window.agenttiles.decidePermission(pending.id, request)) onClose();
      else failed = true;
    } catch {
      failed = true;
    } finally {
      sending = false;
    }
  }

  function deny(): void {
    void send({ decision: 'deny', ...(feedback.trim() ? { message: feedback.trim() } : {}) });
  }

  /** Plans are approved in Claude Code's own dialog; it does not take that decision from hooks. */
  function openTerminal(): void {
    void window.agenttiles.tileAction(sessionId, 'focus');
    onClose();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  onMount(() => {
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onClose}>
  <div
    class="dialog"
    style:--c={color}
    role="dialog"
    tabindex="-1"
    aria-label={isPlan ? t('dialogs.review.ariaPlan') : t('dialogs.review.ariaChange')}
    onclick={(e) => e.stopPropagation()}
  >
    <div class="head">
      <span class="kind">{isPlan ? t('dialogs.review.plan') : pending.toolName}</span>
      <span class="session">{session}</span>
      <button class="close" onclick={onClose} aria-label={t('dialogs.close')}>✕</button>
    </div>

    {#if pending.plan !== null}
      <div class="body plan md">{@html markdownHtml(pending.plan)}</div>
    {:else if pending.diff}
      {@const diff = pending.diff}
      <div class="file">
        <span class="path" title={diff.path}>{diff.path}</span>
        {#if diff.note}<span class="note">{diff.note}</span>{/if}
        <span class="add">+{diff.added}</span>
        <span class="del">−{diff.removed}</span>
      </div>
      <div class="body">
        <DiffLines lines={diff.lines} />
        {#if diff.truncated}<p class="more">{t('dialogs.review.truncated')}</p>{/if}
      </div>
    {/if}

    {#if !isPlan}
      <textarea bind:value={feedback} rows="2" placeholder={t('dialogs.review.feedbackPlaceholder')}></textarea>
    {/if}

    <div class="foot">
      {#if failed}
        <span class="failed">{t('dialogs.alreadyAnswered')}</span>
      {:else if isPlan}
        <span class="keys">{t('dialogs.review.planHint')}</span>
      {:else}
        <span class="keys">{t('dialogs.review.keys')}</span>
      {/if}
      {#if isPlan}
        <button class="allow" onclick={openTerminal}>{t('dialogs.review.decideInTerminal')}</button>
      {:else}
        <button class="deny" disabled={sending} onclick={deny}>{t('dialogs.review.deny')}</button>
        {#if pending.alwaysLabel}
          <button class="always" disabled={sending} onclick={() => void send({ decision: 'allow', always: true })} title={pending.alwaysLabel}>
            {t('dialogs.review.alwaysAllow')}
          </button>
        {/if}
        <button class="allow" disabled={sending} onclick={() => void send({ decision: 'allow' })}>{t('dialogs.review.allow')}</button>
      {/if}
    </div>
    {#if !isPlan && pending.alwaysLabel}<p class="always-hint">{t('dialogs.review.alwaysHint', { label: pending.alwaysLabel })}</p>{/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 150;
    display: grid;
    place-items: start center;
    padding-top: 72px;
    background: rgb(0 0 0 / 0.45);
  }

  .dialog {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: min(860px, calc(100vw - 32px));
    max-height: calc(100vh - 96px);
    padding: 18px 20px;
    background: var(--surface);
    border: 1px solid color-mix(in srgb, var(--c) 45%, var(--border));
    border-top: 4px solid var(--c);
    border-radius: 12px;
    box-shadow: var(--shadow);
    font-size: 13px;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .kind {
    color: var(--c);
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .session {
    flex: 1;
    min-width: 0;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .close {
    padding: 2px 8px;
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--muted);
  }

  .close:hover {
    border-color: var(--border);
    color: var(--text);
  }

  .file {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--mono);
    font-size: 12px;
  }

  .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }

  .note {
    color: var(--muted);
  }

  .file .add {
    color: var(--st-done);
  }

  .file .del {
    color: var(--st-error);
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 8px 4px;
    background: color-mix(in srgb, var(--surface-2) 60%, transparent);
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .plan {
    padding: 10px 14px;
    font-size: 13.5px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .md :global(code) {
    font-family: var(--mono);
    font-size: 0.92em;
  }

  .md :global(pre) {
    margin: 4px 0;
    padding: 6px 8px;
    background: var(--surface);
    border-radius: 6px;
    font-family: var(--mono);
    font-size: 12px;
    white-space: pre-wrap;
  }

  .more {
    margin: 6px 8px 0;
    color: var(--muted);
    font-size: 12px;
  }

  textarea {
    resize: vertical;
    padding: 6px 8px;
    font: inherit;
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  .foot {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .keys {
    flex: 1;
    color: var(--muted);
    font-size: 11px;
  }

  .failed {
    flex: 1;
    color: var(--st-error);
    font-size: 12px;
  }

  .foot button {
    padding: 6px 16px;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    color: #fff;
  }

  .foot button:disabled {
    opacity: 0.45;
  }

  .allow {
    background: var(--st-done);
  }

  .always {
    background: color-mix(in srgb, var(--st-done) 65%, var(--surface-2));
  }

  .deny {
    background: var(--st-error);
  }

  .always-hint {
    margin: -4px 0 0;
    color: var(--muted);
    font-size: 11px;
    text-align: right;
  }
</style>
