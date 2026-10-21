<script lang="ts">
  import { onMount } from 'svelte';
  import type { DoctorReport } from '../../../core/types';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();
  let report = $state<DoctorReport | null>(null);
  let loading = $state(false);
  let failure = $state<string | null>(null);

  async function load(): Promise<void> {
    loading = true;
    failure = null;
    try {
      report = await window.ccdash.runDoctor();
    } catch (error) {
      failure = (error as Error).message;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onClose}>
  <div class="panel" onclick={(e) => e.stopPropagation()}>
    <div class="head">
      <h2>Diagnostics</h2>
      <div>
        <button onclick={load} disabled={loading}>{loading ? 'Running…' : 'Refresh'}</button>
        <button onclick={onClose} aria-label="Close">✕</button>
      </div>
    </div>
    {#if failure}<p class="bad">{failure}</p>{/if}
    {#if report}
      <dl>
        <dt>Claude Code</dt>
        <dd>{report.claudeVersion ?? 'not found in PATH'}</dd>
        <dt>IPC server</dt>
        <dd class={report.ipcListening ? 'good' : 'bad'}>{report.ipcListening ? 'listening' : 'not listening'} · {report.ipcPath}</dd>
        <dt>Hooks</dt>
        <dd class={report.integration.hooksInstalled ? 'good' : 'bad'}>{report.integration.hooksInstalled ? 'installed' : 'not installed'}</dd>
        <dt>Statusline</dt>
        <dd class={report.integration.statuslineInstalled ? 'good' : 'bad'}>{report.integration.statuslineInstalled ? 'installed' : 'not installed'}</dd>
        <dt>Node.js</dt>
        <dd>{report.integration.nodePath ?? '–'}</dd>
        <dt>Other claude processes</dt>
        <dd>
          {#if report.unregisteredPids === null}
            not available on this OS
          {:else if report.unregisteredPids.length === 0}
            none
          {:else}
            {report.unregisteredPids.join(', ')} <small>(no registry entry: print mode, background workers or a crashed session)</small>
          {/if}
        </dd>
        {#if report.agentsError}
          <dt>claude agents</dt>
          <dd class="bad">{report.agentsError}</dd>
        {/if}
      </dl>
      <table>
        <thead>
          <tr><th>PID</th><th>Name</th><th>Registry</th><th>claude agents</th><th>Alive</th><th>Shown</th></tr>
        </thead>
        <tbody>
          {#each report.rows as row (row.pid)}
            <tr>
              <td>{row.pid}</td>
              <td title={row.sessionId}>{row.name}</td>
              <td>{row.registryStatus}</td>
              <td>{row.agentsStatus ?? '–'}</td>
              <td class={row.alive ? 'good' : 'bad'}>{row.alive ? 'yes' : 'no'}</td>
              <td>{row.shown ? 'yes' : 'no'}</td>
            </tr>
          {:else}
            <tr><td colspan="6">No registry entries.</td></tr>
          {/each}
        </tbody>
      </table>
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
    width: min(860px, calc(100% - 32px));
    max-height: calc(100% - 32px);
    overflow: auto;
    padding: 16px 20px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow);
    user-select: text;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .head button {
    padding: 4px 10px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  h2 {
    margin: 0;
    font-size: 18px;
  }

  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 16px;
    margin: 14px 0;
  }

  dt {
    color: var(--muted);
  }

  dd {
    margin: 0;
    word-break: break-all;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  th,
  td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    text-align: left;
  }

  th {
    color: var(--muted);
    font-weight: 600;
  }

  .good {
    color: var(--st-done);
  }

  .bad {
    color: var(--st-error);
  }
</style>
