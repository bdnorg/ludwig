<script lang="ts">
  import type { NoteEntity } from '../model/types';
  import { table } from '../state/store.svelte';

  let { note }: { note: NoteEntity } = $props();
  let editing = $state(false);
  let draft = $state('');

  // live size during a resize drag; committed on release
  let live = $state<{ w: number; h: number } | null>(null);
  let start: { sx: number; sy: number; w: number; h: number } | null = null;

  const w = $derived(live?.w ?? note.config.w ?? 140);
  const h = $derived(live?.h ?? note.config.h ?? 90);

  function startEdit(e: Event) {
    e.stopPropagation();
    draft = note.state.text;
    editing = true;
  }

  function commit() {
    editing = false;
    if (draft !== note.state.text)
      table.update(note, (n) => {
        n.state.text = draft;
      });
  }

  function beginResize(e: PointerEvent) {
    if (e.button !== 0 || note.locked) return;
    e.stopPropagation();
    start = { sx: e.clientX, sy: e.clientY, w, h };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }
  function onMove(e: PointerEvent) {
    if (!start) return;
    const k = table.uiScale || 1;
    live = {
      w: Math.max(80, start.w + (e.clientX - start.sx) / k),
      h: Math.max(50, start.h + (e.clientY - start.sy) / k),
    };
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    start = null;
    if (!live) return;
    const { w, h } = live;
    table.update(note, (n) => {
      n.config.w = Math.round(w);
      n.config.h = Math.round(h);
    });
    live = null;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="note"
  style:background={note.config.color}
  style:width="{w}px"
  style:min-height="{h}px"
  ondblclick={startEdit}
>
  {#if editing}
    <!-- svelte-ignore a11y_autofocus -->
    <textarea
      bind:value={draft}
      style:height="{h - 12}px"
      onblur={commit}
      onpointerdown={(e) => e.stopPropagation()}
      autofocus
    ></textarea>
  {:else}
    <span>{note.state.text || 'double-click to edit'}</span>
  {/if}
  {#if !note.locked}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="handle" onpointerdown={beginResize} ondblclick={(e) => e.stopPropagation()}></div>
  {/if}
</div>

<style>
  .note {
    padding: 8px;
    border-radius: 3px;
    color: #33301f;
    font-size: 0.8rem;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.35);
    white-space: pre-wrap;
    word-break: break-word;
    position: relative;
  }
  span {
    user-select: none;
  }
  textarea {
    width: 100%;
    border: none;
    background: transparent;
    font: inherit;
    color: inherit;
    resize: none;
    outline: none;
  }
  .handle {
    position: absolute;
    right: -5px;
    bottom: -5px;
    width: 12px;
    height: 12px;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.35);
    cursor: nwse-resize;
    opacity: 0;
  }
  .note:hover .handle {
    opacity: 0.8;
  }
</style>
