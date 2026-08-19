<script lang="ts">
  // The inspector (v5): a screen-chrome panel showing the hovered card at
  // readable size with its full rules text. Hover any card ~a third of a
  // second, or press `v` to pin it open. While pinned, the header bar drags
  // the panel anywhere and the corner handle resizes it — both remembered
  // per browser. Shows only faces the viewer may see.
  import { table } from '../state/store.svelte';
  import { inspect, savePanel } from '../state/inspect.svelte';
  import { faceVisible } from '../model/mats';
  import CardFaceView from './CardFaceView.svelte';

  const DELAY_MS = 320;
  const MIN_W = 130;
  const MAX_W = 480;

  // hover target debounced: appearing instantly on every pass would flicker
  let shownHoverId = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const id = inspect.hoverId;
    clearTimeout(timer);
    if (!id) {
      shownHoverId = null;
    } else {
      timer = setTimeout(() => (shownHoverId = id), DELAY_MS);
    }
  });

  const card = $derived.by(() => {
    const id = inspect.pinnedId ?? shownHoverId;
    const e = id ? table.get(id) : null;
    return e?.kind === 'card' ? e : null;
  });
  // never reveal what the viewer isn't entitled to
  const face = $derived(
    card && faceVisible(table.state, card, table.me.id) ? card.config.front : null,
  );
  const scale = $derived(card ? inspect.panel.w / card.config.w : 1);
  const pinned = $derived(inspect.pinnedId !== null);

  // ---- panel drag / resize (pinned only; a transient panel vanishes the
  // moment the pointer leaves the card, so there'd be nothing to grab) ----
  let panelEl: HTMLDivElement | undefined = $state();
  let gesture: { mode: 'move' | 'resize'; dx: number; dy: number; w0: number } | null = null;

  function startMove(e: PointerEvent) {
    if (!panelEl) return;
    const r = panelEl.getBoundingClientRect();
    gesture = { mode: 'move', dx: e.clientX - r.left, dy: e.clientY - r.top, w0: 0 };
    grab(e);
  }
  function startResize(e: PointerEvent) {
    gesture = { mode: 'resize', dx: e.clientX, dy: 0, w0: inspect.panel.w };
    grab(e);
  }
  function grab(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }
  function onMove(e: PointerEvent) {
    if (!gesture) return;
    if (gesture.mode === 'move') {
      savePanel({
        x: Math.max(0, Math.min(window.innerWidth - 60, e.clientX - gesture.dx)),
        y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - gesture.dy)),
      });
    } else {
      savePanel({ w: Math.max(MIN_W, Math.min(MAX_W, gesture.w0 + (e.clientX - gesture.dx))) });
    }
  }
  function onUp() {
    gesture = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }
</script>

{#if card && face}
  <div
    bind:this={panelEl}
    class="inspector"
    class:pinned
    style:left={inspect.panel.x !== null ? `${inspect.panel.x}px` : undefined}
    style:top={inspect.panel.y !== null ? `${inspect.panel.y}px` : undefined}
    style:right={inspect.panel.x === null ? '14px' : undefined}
  >
    {#if pinned}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="bar" onpointerdown={startMove} title="drag to move the inspector">
        <span>v unpins</span>
      </div>
    {/if}
    <CardFaceView {face} w={card.config.w * scale} h={card.config.h * scale} detail fontScale={scale * 0.95} />
    {#if pinned}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="grip" onpointerdown={startResize} title="drag to resize"></div>
    {:else}
      <span class="hint">v pins</span>
    {/if}
  </div>
{/if}

<style>
  .inspector {
    position: fixed;
    top: 60px;
    z-index: 250000;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    filter: drop-shadow(0 4px 14px rgba(0, 0, 0, 0.55));
  }
  .inspector.pinned {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
    border-radius: 8px;
  }
  /* only the pinned chrome is interactive; the card face never blocks play */
  .bar {
    pointer-events: auto;
    align-self: stretch;
    cursor: move;
    background: rgba(30, 34, 43, 0.9);
    border-radius: 6px;
    text-align: center;
    touch-action: none;
  }
  .bar span {
    font-size: 0.62rem;
    color: var(--muted);
  }
  .grip {
    pointer-events: auto;
    position: absolute;
    right: -8px;
    bottom: -8px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--accent);
    border: 1.5px solid rgba(255, 255, 255, 0.8);
    cursor: nwse-resize;
    touch-action: none;
  }
  .hint {
    font-size: 0.62rem;
    color: var(--muted);
    background: rgba(30, 34, 43, 0.85);
    border-radius: 5px;
    padding: 1px 7px;
  }
</style>
