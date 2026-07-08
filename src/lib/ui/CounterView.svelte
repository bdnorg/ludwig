<script lang="ts">
  import type { CounterEntity } from '../model/types';
  import { table } from '../state/store.svelte';

  let { counter }: { counter: CounterEntity } = $props();

  function bump(delta: number) {
    table.update(counter, (c) => {
      c.state.value += delta;
    });
  }
</script>

<div class="counter">
  <span class="label">{counter.config.label}</span>
  <div class="row">
    <button onpointerdown={(e) => e.stopPropagation()} ondblclick={(e) => e.stopPropagation()} onclick={() => bump(-1)}>−</button>
    <span class="value">{counter.state.value}</span>
    <button onpointerdown={(e) => e.stopPropagation()} ondblclick={(e) => e.stopPropagation()} onclick={() => bump(1)}>+</button>
  </div>
</div>

<style>
  .counter {
    background: var(--panel);
    border: 1px solid #454f60;
    border-radius: 8px;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-width: 92px;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.35);
  }
  .label {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    user-select: none;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .value {
    font-size: 1.2rem;
    font-weight: 700;
    min-width: 2ch;
    text-align: center;
    user-select: none;
  }
  button {
    padding: 0 8px;
    font-size: 1rem;
    line-height: 1.5;
  }
</style>
