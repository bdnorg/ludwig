<script lang="ts">
  import { parseHash } from './lib/roomcode';
  import Lobby from './lib/ui/Lobby.svelte';
  import Table from './lib/ui/Table.svelte';

  let route = $state(parseHash());
  window.addEventListener('hashchange', () => (route = parseHash()));
</script>

{#if route.room}
  {#key route.room}
    <Table room={route.room} />
  {/key}
{:else}
  <Lobby />
{/if}
