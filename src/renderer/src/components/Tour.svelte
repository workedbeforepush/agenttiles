<script lang="ts">
  import { onMount, tick } from 'svelte';

  interface Props {
    /** The last step offers the hooks while they are missing. */
    hooksInstalled: boolean;
    installing: boolean;
    onInstall: () => void;
    onDone: () => void;
  }

  let { hooksInstalled, installing, onInstall, onDone }: Props = $props();

  interface Step {
    icon: string;
    title: string;
    body: string;
    /** CSS selector of the element to spotlight; none for the centered welcome and finish cards. */
    target?: string;
  }

  const STEPS: Step[] = [
    {
      icon: '👋',
      title: 'Welcome to AgentTiles',
      body: 'Every Claude Code session on one screen, so nothing ever waits on you unnoticed. Take the one-minute tour: the sessions you see now are made up, your real ones are untouched.',
    },
    {
      icon: '🚦',
      title: 'Status at a glance',
      body: 'How many sessions are working, waiting for you or done. Click a counter to show only those tiles; click more to combine.',
      target: '[aria-label="Filter by state"]',
    },
    {
      icon: '🙋',
      title: 'Never miss a waiting session',
      body: 'Approvals, questions and plans line up here, longest waiting first. Press 1–9 to pick one, Enter to answer or jump, D to deny.',
      target: 'section.banner',
    },
    {
      icon: '🧩',
      title: 'One tile per session',
      body: 'Live activity, the last prompt and reply, branch, context and cost. Click a tile to land right in its terminal tab, click again to send it back.',
      target: '.tile',
    },
    {
      icon: '✅',
      title: 'Approve right here',
      body: 'See exactly what Claude wants to run or change, open the diff, then Allow, Always or Deny. Approving is always a deliberate click, never a stray key press.',
      target: '.tile .actions',
    },
    {
      icon: '⏳',
      title: 'Stay ahead of your limits',
      body: 'Your 5-hour and weekly plan usage, with a heads-up when the current pace would hit the limit before it resets. Click to check now.',
      target: '.group.limits',
    },
    {
      icon: '📊',
      title: 'Know what your day is worth',
      body: 'API-equivalent cost today. Click it for stats per day, project and model, read straight from your transcripts.',
      target: '.item.today',
    },
    {
      icon: '🚀',
      title: 'Start or pick up work',
      body: 'Open a new session in any recent project, or resume one that ended, in a fresh terminal tab.',
      target: '[aria-label="New session"]',
    },
    {
      icon: '⚙️',
      title: 'Make it yours',
      body: 'Tile size, sounds, keys, theme and more. This tour waits in Settings whenever you want to see it again.',
      target: '[aria-label="Settings"]',
    },
    {
      icon: '🎉',
      title: "You're all set!",
      body: '',
    },
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

<div class="tour" role="dialog" aria-modal="true" aria-label="Welcome tour">
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
        <h2>{step.title}</h2>
        {#if index === LAST}
          {#if hooksInstalled}
            <p>AgentTiles is connected to Claude Code. Now go build something great.</p>
          {:else}
            <p>
              One last step: connect AgentTiles to Claude Code. The hooks bring live tool activity and Allow / Deny on
              tiles, the statusline wrapper adds cost, context and plan limits.
            </p>
            <p class="hint">
              They go into <code>~/.claude/settings.json</code>; your own hooks and statusline keep working. Settings
              can install or remove them any time.
            </p>
          {/if}
        {:else}
          <p>{step.body}</p>
        {/if}
      </div>
    {/key}

    <div class="foot">
      <div class="dots" aria-label="Step {index + 1} of {STEPS.length}">
        {#each STEPS as _, i (i)}
          <button class="dot" class:active={i === index} class:seen={i < index} onclick={() => go(i)} aria-label="Step {i + 1}"></button>
        {/each}
      </div>
      <div class="buttons">
        {#if index === 0}
          <button class="secondary" onclick={() => go(LAST)}>Skip</button>
          <button class="primary" onclick={() => go(1)}>Show me around →</button>
        {:else if index < LAST}
          <button class="secondary" onclick={() => go(index - 1)}>Back</button>
          <button class="primary" onclick={() => go(index + 1)}>Next →</button>
        {:else if hooksInstalled}
          <button class="primary" onclick={onDone}>Let's go 🚀</button>
        {:else}
          <button class="secondary" disabled={installing} onclick={onDone}>Not now</button>
          <button class="primary" disabled={installing} onclick={onInstall}>
            {installing ? 'Installing…' : 'Install hooks and statusline'}
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
