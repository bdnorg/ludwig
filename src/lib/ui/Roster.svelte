<script lang="ts">
  import { table } from '../state/store.svelte';
  import { handOf } from '../model/containers';
  import { containerCards } from '../model/containers';

  const connectedIds = $derived(
    [...new Set([table.me.id, ...Object.values(table.peers)])].sort(),
  );

  function handCount(pid: string): number {
    const h = handOf(table.state, pid);
    return h ? containerCards(table.state, h).length : 0;
  }
  function revealed(pid: string): boolean {
    return handOf(table.state, pid)?.state.revealedTo === 'all';
  }
</script>

<div class="roster">
  {#each connectedIds as pid (pid)}
    <div class="player">
      <span class="dot" style:background={table.players[pid]?.color ?? '#888'}></span>
      <span class="name">{table.playerName(pid)}{pid === table.me.id ? ' (you)' : ''}</span>
      <span class="cards">🂠 {handCount(pid)}{revealed(pid) ? ' 👁' : ''}</span>
    </div>
  {/each}
</div>

<style>
  .roster {
    position: absolute;
    top: 54px;
    right: 10px;
    background: rgba(30, 34, 43, 0.92);
    border: 1px solid #454f60;
    border-radius: 8px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    z-index: 200000;
    font-size: 0.8rem;
  }
  .player {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: none;
  }
  .name {
    max-width: 10rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cards {
    margin-left: auto;
    color: var(--muted);
    padding-left: 10px;
  }
</style>
