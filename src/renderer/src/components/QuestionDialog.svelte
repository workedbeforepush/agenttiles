<script lang="ts">
  import { onMount } from 'svelte';
  import type { QuestionView } from '../../../core/types';

  interface Props {
    id: string;
    session: string;
    questions: QuestionView[];
    onClose: () => void;
  }

  let { id, session, questions, onClose }: Props = $props();

  // The dialog is recreated per request ({#key} in App), so reading `questions` once is intended.
  /** Per question: chosen labels, free text and whether the free-text row is chosen. */
  // svelte-ignore state_referenced_locally
  let chosen = $state<string[][]>(questions.map(() => []));
  // svelte-ignore state_referenced_locally
  let other = $state<string[]>(questions.map(() => ''));
  // svelte-ignore state_referenced_locally
  let otherOn = $state<boolean[]>(questions.map(() => false));
  let step = $state(0);
  let cursor = $state(0);
  let sending = $state(false);
  let failed = $state(false);
  let otherInput = $state<HTMLInputElement | null>(null);

  const q = $derived(questions[step]);
  /** Options plus the free-text row at the end. */
  const rows = $derived((q?.options.length ?? 0) + 1);
  const otherRow = $derived(rows - 1);
  const last = $derived(step === questions.length - 1);

  function answerOf(index: number): string {
    const text = otherOn[index] ? (other[index] ?? '').trim() : '';
    const labels = chosen[index] ?? [];
    if (questions[index]?.multiSelect) return [...labels, ...(text ? [text] : [])].join(', ');
    return text || labels[0] || '';
  }

  const answered = $derived(questions.map((_, i) => answerOf(i).length > 0));
  const complete = $derived(answered.every(Boolean));

  function go(to: number): void {
    step = Math.max(0, Math.min(questions.length - 1, to));
    cursor = 0;
  }

  function choose(row: number): void {
    if (!q) return;
    cursor = row;
    if (row === otherRow) {
      if (!q.multiSelect) chosen[step] = [];
      otherOn[step] = q.multiSelect ? !otherOn[step] : true;
      if (otherOn[step]) queueMicrotask(() => otherInput?.focus());
      return;
    }
    const label = q.options[row]?.label;
    if (!label) return;
    if (q.multiSelect) {
      const current = chosen[step] ?? [];
      chosen[step] = current.includes(label) ? current.filter((l) => l !== label) : [...current, label];
      return;
    }
    chosen[step] = [label];
    otherOn[step] = false;
    // Single choice: move on by itself, like the terminal dialog.
    if (!last) go(step + 1);
  }

  async function submit(): Promise<void> {
    if (!complete || sending) return;
    sending = true;
    const answers = Object.fromEntries(questions.map((question, i) => [question.question, answerOf(i)]));
    const ok = await window.ccdash.answerQuestion(id, answers);
    sending = false;
    if (ok) onClose();
    else failed = true;
  }

  function next(): void {
    if (last) void submit();
    else go(step + 1);
  }

  function onKey(event: KeyboardEvent): void {
    const typing = event.target === otherInput;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (!typing && cursor !== otherRow && !(chosen[step] ?? []).length && !q?.multiSelect) choose(cursor);
      else next();
      return;
    }
    if (typing) return;
    if (event.key === 'ArrowDown') cursor = (cursor + 1) % rows;
    else if (event.key === 'ArrowUp') cursor = (cursor - 1 + rows) % rows;
    else if (event.key === 'ArrowRight') go(step + 1);
    else if (event.key === 'ArrowLeft') go(step - 1);
    else if (event.key === ' ') choose(cursor);
    else if (/^[1-9]$/.test(event.key) && Number(event.key) <= rows) choose(Number(event.key) - 1);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  function isChecked(row: number): boolean {
    if (row === otherRow) return otherOn[step] ?? false;
    const label = q?.options[row]?.label;
    return label !== undefined && (chosen[step] ?? []).includes(label);
  }

  onMount(() => {
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onClose}>
  <div class="dialog" role="dialog" tabindex="-1" aria-label="Answer question" onclick={(e) => e.stopPropagation()}>
    <div class="head">
      <span class="kind">Question</span>
      <span class="session">{session}</span>
      <button class="close" onclick={onClose} aria-label="Close">✕</button>
    </div>

    {#if questions.length > 1}
      <div class="tabs">
        {#each questions as question, i (i)}
          <button class="tab" class:active={i === step} class:done={answered[i]} onclick={() => go(i)}>
            <span class="mark">{answered[i] ? '✓' : '○'}</span>{question.header || `Q${i + 1}`}
          </button>
        {/each}
        <span class="progress">{step + 1} / {questions.length}</span>
      </div>
    {/if}

    {#if q}
      <h3>{q.question}</h3>
      {#if q.multiSelect}<p class="hint">Select all that apply</p>{/if}
      <div class="options" role={q.multiSelect ? 'group' : 'radiogroup'}>
        {#each q.options as option, row (option.label)}
          <button
            class="option"
            class:checked={isChecked(row)}
            class:cursor={cursor === row}
            onclick={() => choose(row)}
            onmouseenter={() => (cursor = row)}
          >
            <span class="indicator" class:box={q.multiSelect}></span>
            <span class="key">{row + 1}</span>
            <span class="body">
              <span class="label">{option.label}</span>
              {#if option.description}<span class="description">{option.description}</span>{/if}
            </span>
          </button>
        {/each}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="option other"
          class:checked={isChecked(otherRow)}
          class:cursor={cursor === otherRow}
          onclick={() => {
            if (!isChecked(otherRow)) choose(otherRow);
          }}
          onmouseenter={() => (cursor = otherRow)}
        >
          <span class="indicator" class:box={q.multiSelect}></span>
          <span class="key">{otherRow + 1}</span>
          <input
            bind:this={otherInput}
            bind:value={other[step]}
            placeholder="Type something…"
            oninput={() => {
              if (!otherOn[step]) choose(otherRow);
            }}
          />
        </div>
      </div>
    {/if}

    <div class="foot">
      {#if failed}<span class="failed">Already answered or no longer waiting.</span>{/if}
      <span class="keys">↑↓ select · 1–{rows} pick · Enter next · Esc close</span>
      <button class="secondary" disabled={step === 0} onclick={() => go(step - 1)}>Back</button>
      {#if last}
        <button class="primary" disabled={!complete || sending} onclick={() => void submit()}>
          {sending ? 'Sending…' : 'Submit'}
        </button>
      {:else}
        <button class="primary" onclick={() => go(step + 1)}>Next</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 150;
    display: grid;
    /* Near the top, just below the header, so the question is where the eye already is. */
    place-items: start center;
    padding-top: 72px;
    background: rgb(0 0 0 / 0.45);
  }

  .dialog {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: min(620px, calc(100vw - 32px));
    max-height: calc(100vh - 96px);
    overflow: auto;
    padding: 18px 20px;
    background: var(--surface);
    border: 1px solid color-mix(in srgb, var(--st-needsInput) 45%, var(--border));
    border-top: 4px solid var(--st-needsInput);
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
    color: var(--st-needsInput);
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

  .tabs {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
  }

  .tab.active {
    border-color: var(--st-needsInput);
    color: var(--text);
  }

  .tab.done .mark {
    color: var(--st-done);
  }

  .progress {
    margin-left: auto;
    color: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  h3 {
    margin: 0;
    font-size: 16px;
    line-height: 1.35;
  }

  .hint {
    margin: -6px 0 0;
    color: var(--muted);
    font-size: 12px;
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .option {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    padding: 9px 12px;
    text-align: left;
    background: none;
    border: 1px solid transparent;
    border-radius: 8px;
    cursor: pointer;
  }

  .option.cursor {
    background: var(--surface-2);
  }

  .option.checked {
    border-color: color-mix(in srgb, var(--st-needsInput) 60%, transparent);
    background: color-mix(in srgb, var(--st-needsInput) 12%, var(--surface));
  }

  .indicator {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    margin-top: 1px;
    border: 2px solid var(--muted);
    border-radius: 50%;
  }

  .indicator.box {
    border-radius: 4px;
  }

  .checked .indicator {
    border-color: var(--st-needsInput);
    background: var(--st-needsInput);
    box-shadow: inset 0 0 0 3px var(--surface);
  }

  .checked .indicator.box {
    position: relative;
    box-shadow: none;
  }

  .checked .indicator.box::after {
    content: '';
    position: absolute;
    left: 3px;
    top: 0;
    width: 4px;
    height: 8px;
    border: solid #fff;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }

  .key {
    flex-shrink: 0;
    width: 14px;
    color: var(--muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    margin-top: 2px;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .label {
    font-weight: 600;
  }

  .description {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.4;
  }

  .other input {
    flex: 1;
    min-width: 0;
    padding: 2px 0;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
  }

  .other input:focus {
    outline: none;
    border-bottom-color: var(--st-needsInput);
  }

  .foot {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 4px;
  }

  .keys {
    flex: 1;
    color: var(--muted);
    font-size: 11px;
  }

  .failed {
    color: var(--st-error);
    font-size: 12px;
  }

  .foot button {
    padding: 6px 16px;
    border-radius: 6px;
    font-weight: 600;
  }

  .secondary {
    background: var(--surface-2);
    border: 1px solid var(--border);
  }

  .secondary:disabled {
    opacity: 0.4;
  }

  .primary {
    background: var(--st-needsInput);
    border: 1px solid var(--st-needsInput);
    color: #fff;
  }

  .primary:disabled {
    opacity: 0.45;
  }
</style>
