<script lang="ts">
  import { table } from '../state/store.svelte';

  // fading trail behind each remote cursor (v5): purely local rendering of
  // the pointer stream we already receive — nothing extra travels
  const TRAIL_MS = 800;
  const TRAIL_MAX = 24;
  let trails = $state<Record<string, Array<{ x: number; y: number; t: number }>>>({});
  let now = $state(Date.now());

  $effect(() => {
    for (const [peerId, p] of Object.entries(table.pointers)) {
      const trail = (trails[peerId] ??= []);
      const last = trail[trail.length - 1];
      if (!last || last.x !== p.x || last.y !== p.y)
        trail.push({ x: p.x, y: p.y, t: Date.now() });
      if (trail.length > TRAIL_MAX) trail.splice(0, trail.length - TRAIL_MAX);
    }
  });

  // one shared tick prunes and fades; idle-cheap (only runs with peers)
  $effect(() => {
    if (Object.keys(table.pointers).length === 0) return;
    const iv = setInterval(() => {
      now = Date.now();
      for (const [peerId, trail] of Object.entries(trails)) {
        const cut = now - TRAIL_MS;
        while (trail.length && trail[0].t < cut) trail.shift();
        if (trail.length === 0 && !table.pointers[peerId]) delete trails[peerId];
      }
    }, 60);
    return () => clearInterval(iv);
  });
</script>

{#each Object.entries(trails) as [peerId, trail] (peerId)}
  {@const player = table.players[table.pointers[peerId]?.playerId]}
  {#each trail as pt (pt.t)}
    <div
      class="dot"
      style:left="{pt.x}px"
      style:top="{pt.y}px"
      style:background={player?.color ?? '#888'}
      style:opacity={Math.max(0, 1 - (now - pt.t) / TRAIL_MS) * 0.55}
    ></div>
  {/each}
{/each}

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
  .dot {
    position: absolute;
    z-index: 249999;
    pointer-events: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
  }
</style>
