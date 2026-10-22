<script lang="ts">
  import type { DaySummary, ProjectDay, StatsView, TodayView } from '../../../core/types';
  import { USAGE_COST_HINT, duration, tokenCount, usd } from '../format';

  interface Props {
    today: TodayView;
    onClose: () => void;
  }

  let { today, onClose }: Props = $props();

  type Range = 'today' | 7 | 30;
  let range = $state<Range>('today');
  let stats = $state<StatsView | null>(null);
  let failed = $state(false);
  let hover = $state<{ chart: string; index: number } | null>(null);

  async function load(days: 7 | 30): Promise<void> {
    failed = false;
    try {
      const result = await window.agenttiles.getStats(days);
      // A slower answer for a range the user already left must not overwrite the current one.
      if (range === days) stats = result;
    } catch {
      if (range === days) failed = true;
    }
  }

  function pick(next: Range): void {
    range = next;
    hover = null;
    stats = null;
    if (next !== 'today') void load(next);
  }

  const sum = (projects: Record<string, ProjectDay>[], key: keyof ProjectDay): number =>
    projects.reduce((total, p) => total + Object.values(p).reduce((s, day) => s + day[key], 0), 0);

  const days = $derived(stats?.days ?? []);
  const totals = $derived.by(() => {
    const all = days.map((d) => d.projects);
    return { cost: sum(all, 'costUsd'), turns: sum(all, 'turns'), working: sum(all, 'workingMs'), waiting: sum(all, 'waitingMs') };
  });

  /** Per project over the range, most expensive first. */
  const projects = $derived.by(() => {
    const merged = new Map<string, ProjectDay>();
    for (const day of days) {
      for (const [name, p] of Object.entries(day.projects)) {
        const m = merged.get(name) ?? { costUsd: 0, turns: 0, workingMs: 0, waitingMs: 0 };
        merged.set(name, {
          costUsd: m.costUsd + p.costUsd,
          turns: m.turns + p.turns,
          workingMs: m.workingMs + p.workingMs,
          waitingMs: m.waitingMs + p.waitingMs,
        });
      }
    }
    return [...merged].sort((a, b) => b[1].costUsd - a[1].costUsd || b[1].workingMs - a[1].workingMs);
  });

  const dayCost = (d: DaySummary): number => Object.values(d.projects).reduce((s, p) => s + p.costUsd, 0);
  const dayWorking = (d: DaySummary): number => Object.values(d.projects).reduce((s, p) => s + p.workingMs, 0);

  function label(date: string): string {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y!, m! - 1, d!).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function hours(value: number): string {
    return value === 0 ? '0' : `${value.toFixed(value < 10 ? 1 : 0)} h`;
  }

  /** A clean axis maximum: 1, 2 or 5 times a power of ten, at least the largest value. */
  function niceMax(value: number): number {
    if (value <= 0) return 1;
    const power = 10 ** Math.floor(Math.log10(value));
    return ([1, 2, 5, 10].map((f) => f * power).find((v) => v >= value) ?? 10 * power);
  }

  /** Per model over the range, most expensive first. */
  const models = $derived(Object.entries(stats?.models ?? {}).sort((a, b) => (b[1].costUsd ?? 0) - (a[1].costUsd ?? 0)));

  let exported = $state<string | null>(null);

  async function exportCsv(): Promise<void> {
    exported = await window.agenttiles.exportUsage();
  }

  const before = $derived(stats && days[0] && stats.recordedSince > days[0].date ? stats.recordedSince : null);
</script>

{#snippet chart(id: string, title: string, values: number[], format: (v: number) => string)}
  {@const max = niceMax(Math.max(...values, 0))}
  <figure class="chart">
    <figcaption>{title}</figcaption>
    <div class="plot">
      <div class="axis"><span>{format(max)}</span><span>0</span></div>
      <div class="bars" role="list" onmouseleave={() => (hover = null)}>
        {#each values as value, i (i)}
          <div
            class="slot"
            role="listitem"
            aria-label="{label(days[i]?.date ?? '')}: {format(value)}"
            onmouseenter={() => (hover = { chart: id, index: i })}
          >
            <span class="bar" class:active={hover?.chart === id && hover.index === i} style:height="{(value / max) * 100}%"></span>
            {#if hover?.chart === id && hover.index === i}
              <span class="tip" class:left={i > values.length / 2}>
                <b>{label(days[i]?.date ?? '')}</b>
                {format(value)}
              </span>
            {/if}
          </div>
        {/each}
      </div>
    </div>
    <div class="dates">
      <span>{label(days[0]?.date ?? '')}</span>
      <span>{label(days.at(-1)?.date ?? '')}</span>
    </div>
  </figure>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onClose}>
  <div class="panel" onclick={(e) => e.stopPropagation()}>
    <div class="head">
      <h2>Stats</h2>
      <div class="tabs" role="tablist">
        {#each [['today', 'Today'], [7, '7 days'], [30, '30 days']] as const as [value, text] (value)}
          <button role="tab" aria-selected={range === value} class:active={range === value} onclick={() => pick(value)}>{text}</button>
        {/each}
      </div>
      <button onclick={onClose} aria-label="Close">✕</button>
    </div>

    {#if range === 'today'}
      <div class="grid">
        <div class="stat"><b>{today.sessions}</b><span>sessions</span></div>
        <div class="stat"><b>{today.turns}</b><span>prompts</span></div>
        <div class="stat" style:--c="var(--st-working)"><b>{duration(today.workingMs)}</b><span>Claude working</span></div>
        <div class="stat" style:--c="var(--st-needsApproval)"><b>{duration(today.waitingMs)}</b><span>waiting for you</span></div>
        <div class="stat" title={USAGE_COST_HINT}><b>{usd(today.costUsd)}</b><span>API-equivalent</span></div>
      </div>
      <p class="hint">
        Working and waiting time add up across sessions, so they can exceed the wall clock. Prompts are counted from
        hook events only.
      </p>
    {:else if failed}
      <p class="hint">Stats could not be loaded.</p>
    {:else if stats}
      <div class="grid">
        <div class="stat" title={USAGE_COST_HINT}><b>{usd(totals.cost)}</b><span>API-equivalent</span></div>
        <div class="stat"><b>{totals.turns}</b><span>prompts</span></div>
        <div class="stat" style:--c="var(--st-working)"><b>{duration(totals.working)}</b><span>Claude working</span></div>
        <div class="stat" style:--c="var(--st-needsApproval)"><b>{duration(totals.waiting)}</b><span>waiting for you</span></div>
      </div>
      <div class="charts">
        {@render chart('cost', 'API-equivalent cost per day', days.map(dayCost), usd)}
        {@render chart('working', 'Claude working per day', days.map((d) => dayWorking(d) / 3_600_000), hours)}
      </div>
      {#if projects.length > 0}
        <table>
          <thead>
            <tr><th>Project</th><th>Cost</th><th>Prompts</th><th>Working</th><th>Waiting</th></tr>
          </thead>
          <tbody>
            {#each projects as [name, p] (name)}
              <tr>
                <td class="name" title={name}>{name}</td>
                <td>{usd(p.costUsd)}</td>
                <td>{p.turns}</td>
                <td>{duration(p.workingMs)}</td>
                <td>{duration(p.waitingMs)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="hint">No activity in this range yet.</p>
      {/if}
      {#if models.length > 0}
        <table>
          <thead>
            <tr><th>Model</th><th>Input</th><th>Output</th><th>Cache write</th><th>Cache read</th><th>Cost</th></tr>
          </thead>
          <tbody>
            {#each models as [name, m] (name)}
              <tr>
                <td class="name" title={name}>{name}</td>
                <td>{tokenCount(m.inputTokens)}</td>
                <td>{tokenCount(m.outputTokens)}</td>
                <td>{tokenCount(m.cacheWriteTokens)}</td>
                <td>{tokenCount(m.cacheReadTokens)}</td>
                <td title={m.costUsd === null ? 'No price known for this model' : undefined}>{m.costUsd === null ? '–' : usd(m.costUsd)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      <p class="hint">
        Cost comes from the session transcripts; prompts and times are recorded while AgentTiles runs{#if before}, data
          starts on {label(before)}{/if}.
        <button class="link" onclick={exportCsv}>Export CSV</button>
        {#if exported}<span class="saved">Saved to {exported}</span>{/if}
      </p>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 110;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0.4);
  }

  .panel {
    display: flex;
    flex-direction: column;
    width: min(680px, calc(100% - 32px));
    max-height: calc(100vh - 48px);
    overflow: auto;
    padding: 16px 20px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .head > button {
    margin-left: auto;
    padding: 4px 10px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  h2 {
    margin: 0;
    font-size: 18px;
  }

  .tabs {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--surface-2);
    border-radius: 7px;
  }

  .tabs button {
    padding: 3px 10px;
    background: none;
    border: none;
    border-radius: 5px;
    color: var(--muted);
    font-size: 12px;
  }

  .tabs button.active {
    background: var(--surface);
    color: var(--text);
    font-weight: 600;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px;
    margin: 14px 0 10px;
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    background: var(--surface-2);
    border-radius: 8px;
    border-left: 3px solid var(--c, var(--border));
  }

  .stat b {
    font-size: 22px;
    font-variant-numeric: tabular-nums;
  }

  .stat span {
    color: var(--muted);
    font-size: 12px;
  }

  .charts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 16px;
    margin: 4px 0 12px;
  }

  .chart {
    margin: 0;
  }

  figcaption {
    margin-bottom: 6px;
    font-size: 12px;
    font-weight: 600;
  }

  .plot {
    display: flex;
    gap: 6px;
    height: 120px;
  }

  .axis {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-width: 34px;
    color: var(--muted);
    font-size: 10px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .bars {
    flex: 1;
    display: flex;
    align-items: flex-end;
    gap: 2px;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }

  .slot {
    position: relative;
    flex: 1;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    height: 100%;
  }

  .bar {
    width: 100%;
    max-width: 24px;
    border-radius: 4px 4px 0 0;
    background: var(--accent);
    opacity: 0.85;
  }

  .bar.active {
    opacity: 1;
  }

  .tip {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 50%;
    z-index: 1;
    display: flex;
    flex-direction: column;
    padding: 4px 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: var(--shadow);
    font-size: 11px;
    white-space: nowrap;
    pointer-events: none;
  }

  .tip.left {
    left: auto;
    right: 50%;
  }

  .dates {
    display: flex;
    justify-content: space-between;
    margin-left: 40px;
    color: var(--muted);
    font-size: 10px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  th {
    color: var(--muted);
    font-weight: 600;
    text-align: right;
  }

  th:first-child,
  td.name {
    text-align: left;
  }

  th,
  td {
    padding: 5px 6px;
    border-bottom: 1px solid var(--border);
  }

  td {
    text-align: right;
  }

  td.name {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hint {
    margin: 8px 0 0;
    color: var(--muted);
    font-size: 12px;
  }

  table + table {
    margin-top: 12px;
  }

  .link {
    padding: 0;
    background: none;
    border: none;
    color: var(--accent);
    font-size: inherit;
    text-decoration: underline;
    cursor: pointer;
  }

  .saved {
    margin-left: 6px;
  }
</style>
