<script lang="ts">
  import { table } from '../state/store.svelte';
  import { canSeeCount, canSeeFaces, handOf, matItems } from '../model/mats';
  import { PLAYER_COLORS } from '../state/player';

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

  // clicking MY dot opens a swatch row to change color mid-game (v5 round 3)
  let picking = $state(false);
</script>

<div class="roster">
  {#each connectedIds as pid (pid)}
    <div class="player">
      {#if pid === table.me.id}
        <button
          class="dot mine"
          style:background={table.players[pid]?.color ?? '#888'}
          title="change your color"
          onclick={() => (picking = !picking)}
          aria-label="change your color"
        ></button>
      {:else}
        <span class="dot" style:background={table.players[pid]?.color ?? '#888'}></span>
      {/if}
      <span class="name">{table.playerName(pid)}{pid === table.me.id ? ' (you)' : ''}</span>
      <span class="cards">{handInfo(pid)}</span>
    </div>
    {#if pid === table.me.id && picking}
      <div class="swatches">
        {#each PLAYER_COLORS as c (c)}
          <button
            class="sw"
            style:background={c}
            aria-label="color {c}"
            onclick={() => {
              table.setMyColor(c);
              picking = false;
            }}
          ></button>
        {/each}
        <input
          type="color"
          value={table.me.color}
          title="custom color"
          oninput={(e) => table.setMyColor(e.currentTarget.value)}
        />
      </div>
    {/if}
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
    padding: 0;
    border: none;
  }
  .dot.mine {
    cursor: pointer;
    box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.35);
  }
  .swatches {
    display: flex;
    gap: 4px;
    align-items: center;
    padding: 2px 0 2px 17px;
  }
  .sw {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.4);
    padding: 0;
    cursor: pointer;
  }
  .swatches input[type='color'] {
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
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
