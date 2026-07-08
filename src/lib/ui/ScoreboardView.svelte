<script lang="ts">
  import type { ScoreboardEntity } from '../model/types';
  import { table } from '../state/store.svelte';

  let { board }: { board: ScoreboardEntity } = $props();

  // rows: everyone connected plus anyone who already has a score
  const rows = $derived(
    [
      ...new Set([
        table.me.id,
        ...Object.values(table.peers),
        ...Object.keys(board.state.values),
      ]),
    ].sort(),
  );

  function bump(pid: string, delta: number) {
    table.update(board, (b) => {
      b.state.values[pid] = (b.state.values[pid] ?? 0) + delta;
    });
  }
</script>

<div class="board">
  <span class="label">{board.config.label}</span>
  {#each rows as pid (pid)}
    <div class="row">
      <span class="dot" style:background={table.players[pid]?.color ?? '#888'}></span>
      <span class="name">{table.playerName(pid)}</span>
      <button onpointerdown={(e) => e.stopPropagation()} ondblclick={(e) => e.stopPropagation()} onclick={() => bump(pid, -1)}>−</button>
      <span class="value">{board.state.values[pid] ?? 0}</span>
      <button onpointerdown={(e) => e.stopPropagation()} ondblclick={(e) => e.stopPropagation()} onclick={() => bump(pid, 1)}>+</button>
    </div>
  {/each}
</div>

<style>
  .board {
    background: var(--panel);
    border: 1px solid #454f60;
    border-radius: 8px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 180px;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.35);
  }
  .label {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    text-align: center;
    user-select: none;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 9rem;
    user-select: none;
  }
  .value {
    min-width: 2.5ch;
    text-align: center;
    font-weight: 700;
    user-select: none;
  }
  button {
    padding: 0 6px;
    font-size: 0.85rem;
  }
</style>
