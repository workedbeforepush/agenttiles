<script lang="ts">
  import WithCode from './WithCode.svelte';
  import { onMount, tick } from 'svelte';
  import { t } from '../i18n.svelte';

  interface Props {
    /** The last step offers the hooks while they are missing. */
    hooksInstalled: boolean;
    installing: boolean;
    onInstall: () => void;
    onDone: () => void;
  }

  let { hooksInstalled, installing, onInstall, onDone }: Props = $props();

  interface Step {
    id: 'welcome' | 'counters' | 'banner' | 'tile' | 'approve' | 'limits' | 'today' | 'newSession' | 'settings' | 'done';
    icon: string;
    /** CSS selector of the element to spotlight; none for the centered welcome and finish cards. */
    target?: string;
  }

  const STEPS: Step[] = [
    { id: 'welcome', icon: '👋' },
    { id: 'counters', icon: '🚦', target: '[data-tour="counters"]' },
    { id: 'banner', icon: '🙋', target: 'section.banner' },
    { id: 'tile', icon: '🧩', target: '.tile' },
    { id: 'approve', icon: '✅', target: '.tile .actions' },
    { id: 'limits', icon: '⏳', target: '.group.limits' },
    { id: 'today', icon: '📊', target: '.item.today' },
    { id: 'newSession', icon: '🚀', target: '[data-tour="newSession"]' },
    { id: 'settings', icon: '⚙️', target: '[data-tour="settings"]' },
    { id: 'done', icon: '🎉' },
  ];
  const LAST = STEPS.length - 1;
  /** Space around the spotlighted element and between it and the card. */
  const PAD = 6;
  const GAP = 14;
  const CARD_W = 360;

  let index = $state(0);
  let spot = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  let card = $state<HTMLElement | null>(null);
  let cardPos = $state<{ left: number; top: number } | null>(null);
  const step = $derived(STEPS[index]!);

  /** Spotlights the step's element and places the card below it, or above when there is no room. */
  async function place(): Promise<void> {
    await tick();
    const selector = STEPS[index]?.target;
    const element = selector ? document.querySelector(selector) : null;
    if (!element) {
      spot = null;
      cardPos = null;
      return;
    }
    const r = element.getBoundingClientRect();
    spot = { x: r.left - PAD, y: r.top - PAD, w: r.width + 2 * PAD, h: r.height + 2 * PAD };
    const height = card?.offsetHeight ?? 220;
    const below = r.bottom + PAD + GAP;
    const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, r.top - PAD - GAP - height);
    const left = Math.min(Math.max(8, r.left + r.width / 2 - CARD_W / 2), window.innerWidth - CARD_W - 8);
    cardPos = { left, top };
  }

  function go(next: number): void {
    index = Math.min(LAST, Math.max(0, next));
  }

  function onKey(event: KeyboardEvent): void {
    // The tour owns the keyboard: nothing reaches the dashboard's shortcuts behind it.
    event.stopPropagation();
    if (event.key === 'ArrowRight' || (event.key === 'Enter' && index < LAST)) go(index + 1);
    else if (event.key === 'ArrowLeft') go(index - 1);
    else if (event.key === 'Escape') {
      if (index < LAST) go(LAST);
      else onDone();
    } else return;
    event.preventDefault();
  }

  $effect(() => {
    void index;
    void place();
  });

  onMount(() => {
    const onResize = (): void => {
      void place();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey, true);
    };
  });

  const CONFETTI = ['#4c8dff', '#ffb020', '#22c3d6', '#2fbf71', '#d97757', '#a78bfa'];
  const pieces = Array.from({ length: 36 }, (_, i) => ({
    left: (i * 37) % 100,
    delay: (i % 12) * 0.08,
    color: CONFETTI[i % CONFETTI.length],
    turn: (i * 47) % 360,
  }));
</script>

<div class="tour" role="dialog" aria-modal="true" aria-label={t('tour.label')}>
  {#if spot}
    <div class="spot" style:left="{spot.x}px" style:top="{spot.y}px" style:width="{spot.w}px" style:height="{spot.h}px"></div>
  {:else}
    <div class="dim"></div>
  {/if}

  {#if index === LAST}
    <div class="confetti" aria-hidden="true">
      {#each pieces as p, i (i)}
        <span style:left="{p.left}%" style:animation-delay="{p.delay}s" style:background={p.color} style:--turn="{p.turn}deg"></span>
      {/each}
    </div>
  {/if}

  <div
    bind:this={card}
    class="card"
    class:center={!spot}
    style:left={spot && cardPos ? `${cardPos.left}px` : null}
    style:top={spot && cardPos ? `${cardPos.top}px` : null}
  >
    {#key index}
      <div class="content">
        <div class="icon">{step.icon}</div>
        <h2>{t(`tour.steps.${step.id}.title`)}</h2>
        {#if step.id === 'done'}
          {#if hooksInstalled}
            <p>{t('tour.steps.done.connected')}</p>
          {:else}
            <p>{t('tour.steps.done.connect')}</p>
            <p class="hint"><WithCode text={t('tour.steps.done.connectHint')} codes={{ file: '~/.claude/settings.json' }} /></p>
          {/if}
        {:else}
          <p>{t(`tour.steps.${step.id}.body`)}</p>
        {/if}
      </div>
    {/key}

    <div class="foot">
      <div class="dots" aria-label={t('tour.stepOf', { step: index + 1, count: STEPS.length })}>
        {#each STEPS as _, i (i)}
          <button class="dot" class:active={i === index} class:seen={i < index} onclick={() => go(i)} aria-label={t('tour.step', { step: i + 1 })}></button>
        {/each}
      </div>
      <div class="buttons">
        {#if index === 0}
          <button class="secondary" onclick={() => go(LAST)}>{t('tour.skip')}</button>
          <button class="primary" onclick={() => go(1)}>{t('tour.start')}</button>
        {:else if index < LAST}
          <button class="secondary" onclick={() => go(index - 1)}>{t('tour.back')}</button>
          <button class="primary" onclick={() => go(index + 1)}>{t('tour.next')}</button>
        {:else if hooksInstalled}
          <button class="primary" onclick={onDone}>{t('tour.letsGo')}</button>
        {:else}
          <button class="secondary" disabled={installing} onclick={onDone}>{t('tour.notNow')}</button>
          <button class="primary" disabled={installing} onclick={onInstall}>
            {installing ? t('tour.installing') : t('tour.install')}
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .tour {
    position: fixed;
    inset: 0;
    z-index: 200;
  }

  .dim {
    position: absolute;
    inset: 0;
    background: rgb(0 0 0 / 0.62);
  }

  /* The cut-out: a transparent box whose huge shadow darkens everything around it. */
  .spot {
    position: absolute;
    border-radius: 10px;
    box-shadow:
      0 0 0 3px var(--accent),
      0 0 24px 6px rgb(76 141 255 / 0.55),
      0 0 0 9999px rgb(0 0 0 / 0.62);
    transition:
      left 0.35s ease,
      top 0.35s ease,
      width 0.35s ease,
      height 0.35s ease;
    animation: pulse 1.8s ease-in-out infinite;
    pointer-events: none;
  }

  @keyframes pulse {
    50% {
      box-shadow:
        0 0 0 3px var(--accent),
        0 0 34px 12px rgb(76 141 255 / 0.35),
        0 0 0 9999px rgb(0 0 0 / 0.62);
    }
  }

  .card {
    position: absolute;
    width: 360px;
    padding: 18px 20px 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: var(--shadow);
    transition:
      left 0.35s ease,
      top 0.35s ease;
  }

  .card.center {
    left: 50%;
    top: 38%;
    width: min(460px, calc(100% - 32px));
    padding: 28px 28px 18px;
    text-align: center;
    transform: translate(-50%, -50%);
  }

  .content {
    animation: enter 0.3s ease;
  }

  @keyframes enter {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  .icon {
    font-size: 30px;
    line-height: 1;
  }

  .center .icon {
    font-size: 52px;
    animation: wave 1.6s ease-in-out 0.2s 2;
  }

  @keyframes wave {
    25% {
      transform: rotate(14deg);
    }
    75% {
      transform: rotate(-10deg);
    }
  }

  h2 {
    margin: 10px 0 6px;
    font-size: 18px;
  }

  .center h2 {
    font-size: 22px;
  }

  p {
    margin: 0 0 8px;
    color: var(--text);
    font-size: 13px;
    line-height: 1.5;
  }

  p.hint {
    color: var(--muted);
    font-size: 12px;
  }

  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 12px;
  }

  .center .foot {
    flex-direction: column;
  }

  .dots {
    display: flex;
    gap: 5px;
  }

  .dot {
    width: 7px;
    height: 7px;
    padding: 0;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 50%;
    cursor: pointer;
    transition: width 0.25s ease;
  }

  .dot.seen {
    background: var(--muted);
  }

  .dot.active {
    width: 18px;
    background: var(--accent);
    border-color: var(--accent);
    border-radius: 4px;
  }

  .buttons {
    display: flex;
    gap: 8px;
  }

  .buttons button {
    padding: 7px 14px;
    border-radius: 6px;
    border: 1px solid var(--border);
    white-space: nowrap;
  }

  .primary {
    background: var(--accent);
    border-color: var(--accent) !important;
    color: #fff;
    font-weight: 600;
  }

  .confetti {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .confetti span {
    position: absolute;
    top: -12px;
    width: 8px;
    height: 12px;
    border-radius: 2px;
    opacity: 0;
    animation: fall 2.6s ease-in forwards;
  }

  @keyframes fall {
    0% {
      opacity: 1;
      transform: translateY(0) rotate(0);
    }
    100% {
      opacity: 0;
      transform: translateY(85vh) rotate(var(--turn));
    }
  }
</style>
