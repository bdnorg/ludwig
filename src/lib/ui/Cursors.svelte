<script lang="ts">
  import { table } from '../state/store.svelte';
</script>

{#each Object.entries(table.pointers) as [peerId, p] (peerId)}
  {@const player = table.players[p.playerId]}
  <div class="cursor" style:left="{p.x}px" style:top="{p.y}px">
    <svg width="14" height="18" viewBox="0 0 14 18">
      <path d="M1 1 L13 9 L7 10 L5 17 Z" fill={player?.color ?? '#888'} stroke="#111" />
    </svg>
    <span style:background={player?.color ?? '#888'}>{player?.name ?? '?'}</span>
  </div>
{/each}

<style>
  .cursor {
    position: absolute;
    z-index: 250000;
    pointer-events: none;
    display: flex;
    gap: 2px;
  }
  span {
    font-size: 0.6rem;
    color: #fff;
    padding: 1px 5px;
    border-radius: 6px;
    height: fit-content;
    margin-top: 10px;
    white-space: nowrap;
  }
</style>
