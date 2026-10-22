<script lang="ts">
  import WithCode from './WithCode.svelte';
  import { onMount } from 'svelte';
  import type { LaunchView } from '../../../core/types';
  import { since } from '../format';
  import { t } from '../i18n.svelte';

  interface Props {
    now: number;
    onClose: () => void;
  }

  let { now, onClose }: Props = $props();

  let view = $state<LaunchView | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let query = $state('');

  const needle = $derived(query.trim().toLowerCase());
  const sessions = $derived(
    (view?.sessions ?? []).filter(
      (s) => !needle || s.title.toLowerCase().includes(needle) || s.project.toLowerCase().includes(needle),
    ),
  );

  async function launch(cwd: string, sessionId: string | null): Promise<void> {
    busy = true;
    error = null;
    try {
      error = await window.agenttiles.launchSession(cwd, sessionId);
      if (error === null) onClose();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function chooseFolder(): Promise<void> {
    const folder = await window.agenttiles.pickFolder();
    if (folder) await launch(folder, null);
  }

  onMount(() => {
    window.agenttiles
      .recentSessions()
      .then((result) => (view = result))
      .catch((e: unknown) => (error = (e as Error).message));
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onClose}>
  <div class="panel" role="dialog" tabindex="-1" aria-label={t('newSession.title')} onclick={(e) => e.stopPropagation()}>
    <div class="head">
      <h2>{t('newSession.title')}</h2>
      <button class="close" onclick={onClose} aria-label={t('newSession.close')}>✕</button>
    </div>
    {#if error}<p class="error">{error}</p>{/if}

    <h3>{t('newSession.startIn')}</h3>
    <div class="projects">
      {#each view?.projects ?? [] as project (project.cwd)}
        <button class="project" disabled={busy} title={project.cwd} onclick={() => void launch(project.cwd, null)}>
          {project.project}
        </button>
      {/each}
      <button class="project other" disabled={busy} onclick={() => void chooseFolder()}>{t('newSession.chooseFolder')}</button>
    </div>

    <div class="resume-head">
      <h3>{t('newSession.resume')}</h3>
      <input bind:value={query} placeholder={t('newSession.searchPlaceholder')} aria-label={t('newSession.searchLabel')} />
    </div>
    <div class="sessions">
      {#if view === null && !error}
        <p class="hint">{t('newSession.reading')}</p>
      {:else if sessions.length === 0}
        <p class="hint">{t('newSession.noSessions')}</p>
      {/if}
      {#each sessions as session (session.sessionId)}
        <button class="session" disabled={busy} title={session.cwd} onclick={() => void launch(session.cwd, session.sessionId)}>
          <span class="title">{session.title}</span>
          <span class="meta">{t('newSession.sessionMeta', { project: session.project, ago: since(session.lastAt, now) })}</span>
        </button>
      {/each}
    </div>
    <p class="hint"><WithCode text={t('newSession.hint')} codes={{ claude: 'claude', resume: 'claude --resume' }} /></p>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 110;
    display: grid;
    place-items: start center;
    padding-top: 72px;
    background: rgb(0 0 0 / 0.4);
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(640px, calc(100vw - 32px));
    max-height: calc(100vh - 96px);
    padding: 16px 20px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow);
  }

  .head,
  .resume-head {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  h2 {
    margin: 0;
    font-size: 18px;
  }

  h3 {
    margin: 4px 0 0;
    color: var(--muted);
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .close {
    margin-left: auto;
    padding: 4px 10px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  .projects {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .project {
    padding: 5px 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 12px;
  }

  .project:hover:not(:disabled) {
    border-color: var(--accent);
  }

  .project.other {
    color: var(--muted);
  }

  .resume-head input {
    flex: 1;
    margin-top: 4px;
    padding: 4px 8px;
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    font: inherit;
    font-size: 12px;
  }

  .sessions {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    overflow: auto;
  }

  .session {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    padding: 6px 10px;
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    text-align: left;
  }

  .session:hover:not(:disabled) {
    background: var(--surface-2);
    border-color: var(--border);
  }

  .title {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  .meta,
  .hint {
    color: var(--muted);
    font-size: 12px;
  }

  .hint {
    margin: 0;
  }

  .error {
    margin: 0;
    color: var(--st-error);
    font-size: 12px;
  }
</style>
