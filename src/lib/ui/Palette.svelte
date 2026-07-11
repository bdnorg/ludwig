<script lang="ts">
  import type { Entity } from '../model/types';
  import { actionsFor, type UiAction } from './actions';

  let {
    selection,
    onRun,
    onClose,
  }: { selection: Entity | null; onRun: (a: UiAction) => void; onClose: () => void } = $props();

  let filter = $state('');
  let idx = $state(0);

  const applicable = $derived(
    actionsFor(selection).filter((a) => a.label.toLowerCase().includes(filter.toLowerCase())),
  );

  function what(sel: Entity | null): string {
    if (!sel) return 'nothing selected — hover something first';
    if (sel.kind === 'mat') return `mat “${sel.config.label}”`;
    if (sel.kind === 'card') return 'card';
    return sel.kind;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') idx = Math.min(idx + 1, applicable.length - 1);
    else if (e.key === 'ArrowUp') idx = Math.max(idx - 1, 0);
    else if (e.key === 'Enter' && applicable[idx]) onRun(applicable[idx]);
    else if (e.key === 'Escape') onClose();
    else return;
    e.preventDefault();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onpointerdown={onClose}></div>
<div class="palette">
  <!-- svelte-ignore a11y_autofocus -->
  <input
    placeholder="action for {what(selection)}…"
    bind:value={filter}
    oninput={() => (idx = 0)}
    onkeydown={onKey}
    autofocus
  />
  <div class="list">
    {#each applicable as a, i (a.id)}
      <button class:active={i === idx} onclick={() => onRun(a)}>
        <span>{a.label}</span>
        {#if a.key}<kbd>{a.key}{a.needsMat ? ' + letter' : ''}</kbd>{/if}
      </button>
    {:else}
      <p class="none">no actions apply</p>
    {/each}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 300000;
    background: rgba(0, 0, 0, 0.3);
  }
  .palette {
    position: fixed;
    top: 18vh;
    left: 50%;
    transform: translateX(-50%);
    width: 26rem;
    max-width: 90vw;
    background: var(--panel);
    border: 1px solid #454f60;
    border-radius: 10px;
    z-index: 300001;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
  }
  input {
    width: 100%;
  }
  .list {
    display: flex;
    flex-direction: column;
    max-height: 40vh;
    overflow-y: auto;
  }
  .list button {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: none;
    border: none;
    padding: 6px 10px;
    border-radius: 5px;
    text-align: left;
  }
  .list button:hover,
  .list button.active {
    background: var(--panel-2);
  }
  kbd {
    background: var(--panel-2);
    border: 1px solid #454f60;
    border-radius: 4px;
    padding: 0 6px;
    font-size: 0.7rem;
    color: var(--muted);
  }
  .none {
    color: var(--muted);
    font-size: 0.8rem;
    text-align: center;
    margin: 8px;
  }
</style>
