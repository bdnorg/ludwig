<script lang="ts">
  // The gamebox quick-action strip (SPEC §15): template-defined macros, one
  // click each. Renders only when the current table defines any.
  import type { Entity } from '../model/types';
  import { macroActions } from './actions';

  const actions = $derived(macroActions());
</script>

{#if actions.length > 0}
  <div class="quickbar">
    {#each actions as a (a.id)}
      <button onclick={() => a.run(null as unknown as Entity)}>▶ {a.label}</button>
    {/each}
  </div>
{/if}

<style>
  .quickbar {
    position: absolute;
    top: 54px;
    left: 10px;
    display: flex;
    gap: 6px;
    z-index: 200000;
  }
  button {
    font-size: 0.72rem;
    padding: 3px 10px;
    background: rgba(30, 34, 43, 0.92);
    border: 1px solid #454f60;
    border-radius: 14px;
    color: var(--text);
  }
  button:hover {
    border-color: var(--accent);
  }
</style>
