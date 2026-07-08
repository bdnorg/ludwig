<script lang="ts">
  import type { DiceEntity } from '../model/types';
  import { table } from '../state/store.svelte';

  let { dice }: { dice: DiceEntity } = $props();

  // re-trigger the roll animation whenever a new roll arrives
  const rollKey = $derived(dice.state.rolledAt);
</script>

<div class="dice" title="double-click to roll">
  {#each dice.state.values as v, i (i)}
    {#key rollKey}
      <div class="die" class:d6={dice.config.sides === 6}>
        <span>{v}</span>
        {#if dice.config.sides !== 6}<small>d{dice.config.sides}</small>{/if}
      </div>
    {/key}
  {/each}
  {#if dice.state.rolledBy}
    <span class="who">{table.playerName(dice.state.rolledBy)}</span>
  {/if}
</div>

<style>
  .dice {
    display: flex;
    gap: 6px;
    position: relative;
  }
  .die {
    width: 40px;
    height: 40px;
    background: #f0ece1;
    color: #22242a;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    font-weight: 700;
    font-size: 1.1rem;
    box-shadow:
      inset 0 -3px 0 rgba(0, 0, 0, 0.15),
      0 1px 3px rgba(0, 0, 0, 0.4);
    user-select: none;
    animation: tumble 0.35s ease-out;
  }
  .die small {
    font-size: 0.5rem;
    font-weight: 400;
    color: #777;
    margin-top: -2px;
  }
  @keyframes tumble {
    0% {
      transform: rotate(-25deg) scale(0.7);
    }
    60% {
      transform: rotate(12deg) scale(1.1);
    }
    100% {
      transform: rotate(0) scale(1);
    }
  }
  .who {
    position: absolute;
    bottom: -16px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 0.6rem;
    color: rgba(255, 255, 255, 0.6);
    white-space: nowrap;
    user-select: none;
  }
</style>
