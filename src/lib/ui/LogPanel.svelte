<script lang="ts">
  import { table } from '../state/store.svelte';

  let open = $state(false);

  const entries = $derived(
    Object.entries(table.state.log)
      .sort((a, b) => b[1].at - a[1].at || (a[0] < b[0] ? 1 : -1))
      .slice(0, 100),
  );

  function when(at: number): string {
    return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /** Clear for everyone via the LWW watermark (v4 §11) — do this before
   *  exporting a pristine start-of-game template. */
  function clearLog() {
    table.emit([{ t: 'clear-log', at: Date.now(), version: table.next() }]);
  }
</script>

<div class="logpanel" class:open>
  <button class="head" onclick={() => (open = !open)}>
    ☰ log {entries.length ? `(${entries.length})` : ''}
  </button>
  {#if open}
    <div class="entries">
      {#if entries.length > 0}
        <button class="clear" title="clear the log for everyone" onclick={clearLog}>
          clear log
        </button>
      {/if}
      {#each entries as [id, e] (id)}
        <div class="entry">
          <span class="time">{when(e.at)}</span>
          <span class="text">{e.text}</span>
        </div>
      {:else}
        <p class="none">nothing yet — visibility changes land here</p>
      {/each}
    </div>
  {/if}
</div>

<style>
  .logpanel {
    position: absolute;
    right: 10px;
    bottom: 10px;
    z-index: 200000;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }
  .head {
    font-size: 0.7rem;
    color: var(--muted);
  }
  .entries {
    width: 20rem;
    max-height: 32vh;
    overflow-y: auto;
    background: rgba(30, 34, 43, 0.95);
    border: 1px solid #454f60;
    border-radius: 8px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .entry {
    display: flex;
    gap: 8px;
    font-size: 0.75rem;
  }
  .time {
    color: var(--muted);
    flex: none;
  }
  .none {
    color: var(--muted);
    font-size: 0.75rem;
    margin: 2px;
  }
  .clear {
    align-self: flex-end;
    font-size: 0.65rem;
    padding: 1px 8px;
    color: var(--muted);
  }
</style>
