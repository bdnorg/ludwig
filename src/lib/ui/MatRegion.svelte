<script lang="ts">
  import type { MatEntity } from '../model/types';
  import type { Snippet } from 'svelte';
  import { table } from '../state/store.svelte';

  let {
    mat,
    privileged,
    sizeOverride = null,
    onMove,
    children,
  }: {
    mat: MatEntity;
    privileged: boolean;
    /** fit-contents view: computed extent replaces the configured size and
     *  disables the resize handle (v4 §2) */
    sizeOverride?: { w: number; h: number } | null;
    /** side-handle drag: move the mat itself (PROPOSAL v4 §2) */
    onMove: (e: PointerEvent) => void;
    children: Snippet;
  } = $props();

  // live size during a resize drag; committed on release
  let live = $state<{ w: number; h: number } | null>(null);
  let start: { sx: number; sy: number; w: number; h: number } | null = null;

  const w = $derived(sizeOverride?.w ?? live?.w ?? mat.config.size?.w ?? 300);
  const h = $derived(sizeOverride?.h ?? live?.h ?? mat.config.size?.h ?? 220);

  function beginResize(e: PointerEvent) {
    if (e.button !== 0 || mat.locked) return;
    e.stopPropagation();
    start = { sx: e.clientX, sy: e.clientY, w, h };
    window.addEventListener('pointermove', onResizeMove);
    window.addEventListener('pointerup', onUp);
  }
  function onResizeMove(e: PointerEvent) {
    if (!start) return;
    const k = table.uiScale || 1;
    live = {
      w: Math.max(60, start.w + (e.clientX - start.sx) / k),
      h: Math.max(60, start.h + (e.clientY - start.sy) / k),
    };
  }
  function onUp() {
    window.removeEventListener('pointermove', onResizeMove);
    window.removeEventListener('pointerup', onUp);
    start = null;
    if (!live) return;
    const { w, h } = live;
    table.update(mat, (m) => {
      m.config.size = { w: Math.round(w), h: Math.round(h) };
    });
    live = null;
  }
</script>

<div
  class="region"
  class:priv={privileged}
  style:width="{w}px"
  style:height="{h}px"
  style:background={mat.config.color ?? undefined}
>
  {#if mat.config.image}
    <img class="bg" src={mat.config.image} alt={mat.config.label} draggable="false" />
  {/if}
  {#if mat.config.placement.type === 'slots'}
    {#each mat.config.placement.slots ?? [] as slot (slot.id)}
      <span class="slot" style:left="{slot.x}px" style:top="{slot.y}px"></span>
    {/each}
  {/if}
  {#if mat.config.placement.type === 'grid' && !mat.config.placement.grid?.hex}
    <div
      class="gridlines"
      style:background-size="{mat.config.placement.grid?.size ?? 40}px {mat.config.placement.grid
        ?.size ?? 40}px"
    ></div>
  {/if}
  {#if mat.config.placement.type === 'grid' && mat.config.placement.grid?.hex}
    {@const g = mat.config.placement.grid.size}
    {@const dy = Math.round(g * 0.866)}
    {@const dot = 'radial-gradient(circle 2px, rgba(255,255,255,0.25) 98%, transparent)'}
    <div
      class="hexdots"
      style:background-size="{g}px {2 * dy}px"
      style:background-image={`${dot}, ${dot}`}
      style:background-position="0 0, {g / 2}px {dy}px"
    ></div>
  {/if}
  <span class="label">
    {mat.config.label}{mat.config.faceDefault === 'down' ? ' (face down)' : ''}
    {#if privileged}<span class="eye">👁</span>{/if}
  </span>
  <div class="children">
    {@render children()}
  </div>
  {#if !mat.locked}
    {#if !sizeOverride}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="handle" onpointerdown={beginResize} ondblclick={(e) => e.stopPropagation()}></div>
    {/if}
    {#each ['n', 'e', 's', 'w'] as side (side)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="mhandle h-{side}"
        data-handle="move"
        title="move the mat"
        onpointerdown={onMove}
        ondblclick={(e) => e.stopPropagation()}
      ></div>
    {/each}
  {/if}
</div>

<style>
  .region {
    border: 2px dashed color-mix(in srgb, var(--accent) 55%, transparent);
    background: rgba(255, 255, 255, 0.05);
    border-radius: 10px;
    position: relative;
  }
  .region.priv {
    border-style: solid;
    border-color: var(--accent);
  }
  .bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 8px;
    pointer-events: none;
  }
  .children {
    position: absolute;
    inset: 0;
    overflow: visible;
  }
  .slot {
    position: absolute;
    width: 12px;
    height: 12px;
    margin: -6px;
    border-radius: 50%;
    border: 1.5px dashed rgba(255, 255, 255, 0.4);
    pointer-events: none;
  }
  .gridlines {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(to right, rgba(255, 255, 255, 0.07) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255, 255, 255, 0.07) 1px, transparent 1px);
    pointer-events: none;
    border-radius: 8px;
  }
  .hexdots {
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: 8px;
  }
  .label {
    position: absolute;
    top: 4px;
    left: 8px;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.7);
    user-select: none;
    z-index: 1;
  }
  .eye {
    text-transform: none;
  }
  /* handles are invisible until the mat is hovered (PROPOSAL v4 §2) */
  .handle {
    position: absolute;
    right: -6px;
    bottom: -6px;
    width: 14px;
    height: 14px;
    border-radius: 4px;
    background: var(--accent);
    cursor: nwse-resize;
    opacity: 0;
    transition: opacity 0.1s;
    z-index: 2;
  }
  .region:hover .handle {
    opacity: 0.85;
  }
  .mhandle {
    position: absolute;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: rgba(77, 163, 255, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.7);
    cursor: move;
    opacity: 0;
    transition: opacity 0.1s;
    z-index: 2;
  }
  .region:hover .mhandle {
    opacity: 1;
  }
  .h-n {
    top: -6px;
    left: 50%;
    transform: translateX(-50%);
  }
  .h-s {
    bottom: -6px;
    left: 50%;
    transform: translateX(-50%);
  }
  .h-e {
    right: -6px;
    top: 50%;
    transform: translateY(-50%);
  }
  .h-w {
    left: -6px;
    top: 50%;
    transform: translateY(-50%);
  }
</style>
