<script lang="ts">
  import type { DiffLine } from '../../../core/types';

  interface Props {
    lines: DiffLine[];
    /** Show only this many lines (the tile); the dialog shows all. */
    limit?: number;
  }

  let { lines, limit }: Props = $props();

  const MARK: Record<DiffLine['kind'], string> = { add: '+', del: '−', ctx: ' ', skip: '⋯' };
  const shown = $derived(limit === undefined ? lines : lines.slice(0, limit));
</script>

<div class="diff">
  {#each shown as line, i (i)}
    <div class="line {line.kind}"><span class="mark">{MARK[line.kind]}</span><span class="text">{line.text}</span></div>
  {/each}
  {#if limit !== undefined && lines.length > limit}
    <div class="line skip"><span class="mark">⋯</span><span class="text">{lines.length - limit} more lines</span></div>
  {/if}
</div>

<style>
  .diff {
    font-family: var(--mono);
    font-size: 0.85em;
    line-height: 1.45;
  }

  .line {
    display: flex;
    min-width: 0;
  }

  .mark {
    flex-shrink: 0;
    width: 1.4em;
    text-align: center;
    user-select: none;
  }

  .text {
    flex: 1;
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .add {
    background: color-mix(in srgb, var(--st-done) 18%, transparent);
    color: color-mix(in srgb, var(--st-done) 70%, var(--text));
  }

  .del {
    background: color-mix(in srgb, var(--st-error) 16%, transparent);
    color: color-mix(in srgb, var(--st-error) 70%, var(--text));
  }

  .ctx {
    color: var(--muted);
  }

  .skip {
    color: var(--muted);
    font-style: italic;
  }
</style>
