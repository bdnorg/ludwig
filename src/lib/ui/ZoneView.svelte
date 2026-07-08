<script lang="ts">
  import type { ZoneEntity } from '../model/types';
  import { table } from '../state/store.svelte';

  let { zone, scale }: { zone: ZoneEntity; scale: number } = $props();

  // live size during a resize drag; committed on release
  let live = $state<{ w: number; h: number } | null>(null);
  const w = $derived(live?.w ?? zone.config.w);
  const h = $derived(live?.h ?? zone.config.h);

  let start: { sx: number; sy: number; w: number; h: number } | null = null;

  function beginResize(e: PointerEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    start = { sx: e.clientX, sy: e.clientY, w: zone.config.w, h: zone.config.h };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }
  function onMove(e: PointerEvent) {
    if (!start) return;
    live = {
      w: Math.max(60, start.w + (e.clientX - start.sx) / scale),
      h: Math.max(60, start.h + (e.clientY - start.sy) / scale),
    };
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    start = null;
    if (!live) return;
    const { w, h } = live;
    table.update(zone, (z) => {
      z.config.w = Math.round(w);
      z.config.h = Math.round(h);
    });
    live = null;
  }
</script>

<div
  class="zone"
  style:width="{w}px"
  style:height="{h}px"
  style:--zone-color={zone.config.color}
>
  <span class="label">
    {zone.config.label}{zone.config.autoFaceDown ? ' (face down)' : ''}
  </span>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="handle" onpointerdown={beginResize} ondblclick={(e) => e.stopPropagation()}></div>
</div>

<style>
  .zone {
    border: 2px dashed color-mix(in srgb, var(--zone-color) 70%, transparent);
    background: color-mix(in srgb, var(--zone-color) 12%, transparent);
    border-radius: 10px;
    position: relative;
  }
  .label {
    position: absolute;
    top: 4px;
    left: 8px;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: color-mix(in srgb, var(--zone-color) 80%, white);
    user-select: none;
  }
  .handle {
    position: absolute;
    right: -6px;
    bottom: -6px;
    width: 14px;
    height: 14px;
    border-radius: 4px;
    background: var(--zone-color);
    cursor: nwse-resize;
    opacity: 0.7;
  }
  .handle:hover {
    opacity: 1;
  }
</style>
