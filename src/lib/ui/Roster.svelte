<script lang="ts">
  import { table } from '../state/store.svelte';
  import { canSeeCount, canSeeFaces, handOf, matItems } from '../model/mats';

  const connectedIds = $derived(
    [...new Set([table.me.id, ...Object.values(table.peers)])].sort(),
  );

  function handInfo(pid: string): string {
    const h = handOf(table.state, pid);
    if (!h) return '';
    const revealed = canSeeFaces(h, table.me.id) && pid !== table.me.id;
    if (!canSeeCount(h, table.me.id)) return `🂠 ?${revealed ? ' 👁' : ''}`;
    return `🂠 ${matItems(table.state, h).length}${revealed ? ' 👁' : ''}`;
  }
</script>

<div class="roster">
  {#each connectedIds as pid (pid)}
    <div class="player">
      <span class="dot" style:background={table.players[pid]?.color ?? '#888'}></span>
      <span class="name">{table.playerName(pid)}{pid === table.me.id ? ' (you)' : ''}</span>
      <span class="cards">{handInfo(pid)}</span>
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
