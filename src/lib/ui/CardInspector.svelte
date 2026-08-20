<script lang="ts">
  // The inspector (v5): a screen-chrome panel showing the hovered card at
  // readable size with its full rules text. Hover any card ~a third of a
  // second, or press `v` to pin it open. While pinned, the header bar drags
  // the panel anywhere, the corner handle resizes it, and the 📌 toggle
  // parks it either in SCREEN space (stays put while the table pans) or on
  // the FELT (tracks a table spot as you pan/zoom — your view only). All of
  // it remembered per browser. Shows only faces the viewer may see.
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

  // felt-parked position: a table point projected to the screen every time
  // the view transform changes (the viewport rect only moves on resize)
  function viewportRect() {
    return document.querySelector('.viewport')?.getBoundingClientRect() ?? { left: 0, top: 44 };
  }
  const feltPos = $derived.by(() => {
    if (inspect.panel.space !== 'table') return null;
    const v = table.uiView;
    const r = viewportRect();
    return {
      x: r.left + v.x + (inspect.panel.tx ?? 200) * v.scale,
      y: r.top + v.y + (inspect.panel.ty ?? 200) * v.scale,
    };
  });

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
      const sx = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - gesture.dx));
      const sy = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - gesture.dy));
      if (inspect.panel.space === 'table') {
        const v = table.uiView;
        const r = viewportRect();
        savePanel({ tx: (sx - r.left - v.x) / v.scale, ty: (sy - r.top - v.y) / v.scale });
      } else {
        savePanel({ x: sx, y: sy });
      }
    } else {
      savePanel({ w: Math.max(MIN_W, Math.min(MAX_W, gesture.w0 + (e.clientX - gesture.dx))) });
    }
  }
  function onUp() {
    gesture = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }

  function toggleSpace() {
    if (!panelEl) return;
    // keep the panel where it visually is while switching coordinate spaces
    const r = panelEl.getBoundingClientRect();
    if (inspect.panel.space === 'table') {
      savePanel({ space: 'screen', x: r.left, y: r.top });
    } else {
      const v = table.uiView;
      const vp = viewportRect();
      savePanel({
        space: 'table',
        tx: (r.left - vp.left - v.x) / v.scale,
        ty: (r.top - vp.top - v.y) / v.scale,
      });
    }
  }

  const left = $derived(
    feltPos ? feltPos.x : inspect.panel.x !== null ? inspect.panel.x : null,
  );
  const top = $derived(feltPos ? feltPos.y : inspect.panel.y !== null ? inspect.panel.y : 60);
</script>

{#if card && face}
  <div
    bind:this={panelEl}
    class="inspector"
    class:pinned
    style:left={left !== null ? `${left}px` : undefined}
    style:top="{top}px"
    style:right={left === null ? '14px' : undefined}
  >
    {#if pinned}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="bar" onpointerdown={startMove} title="drag to move the inspector">
        <span>v unpins</span>
        <button
          class="space"
          onpointerdown={(e) => e.stopPropagation()}
          onclick={toggleSpace}
          title={inspect.panel.space === 'table'
            ? 'parked on the felt (moves with the table) — click for screen'
            : 'parked on the screen — click to park on the felt'}
        >
          {inspect.panel.space === 'table' ? '📌 felt' : '📌 screen'}
        </button>
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
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    touch-action: none;
  }
  .bar span {
    font-size: 0.62rem;
    color: var(--muted);
  }
  .bar .space {
    font-size: 0.6rem;
    padding: 0 6px;
    background: none;
    border: 1px solid #454f60;
    border-radius: 5px;
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
