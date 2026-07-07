<script lang="ts">
  import { newRoomCode } from '../roomcode';
  import { loadPlayer, savePlayer } from '../state/player';

  let player = $state(loadPlayer());
  let joinCode = $state('');

  function persistName() {
    savePlayer($state.snapshot(player));
  }

  function createTable() {
    persistName();
    location.hash = `#/t/${newRoomCode()}`;
  }

  function joinTable(e: Event) {
    e.preventDefault();
    const code = joinCode.trim().replace(/^.*#\/t\//, '');
    if (!code) return;
    persistName();
    location.hash = `#/t/${code}`;
  }
</script>

<div class="lobby">
  <h1>ludwig</h1>
  <p class="tag">a table for playing games — bring your own rules</p>

  <label>
    Your name
    <input placeholder="e.g. Beth" bind:value={player.name} onchange={persistName} maxlength="24" />
  </label>

  <button class="primary" onclick={createTable} disabled={!player.name.trim()}>
    Start a new table
  </button>

  <form onsubmit={joinTable}>
    <label>
      Join a table
      <input placeholder="room code or invite link" bind:value={joinCode} />
    </label>
    <button type="submit" disabled={!player.name.trim() || !joinCode.trim()}>Join</button>
  </form>
</div>

<style>
  .lobby {
    max-width: 26rem;
    margin: 12vh auto 0;
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    padding: 1rem;
  }
  h1 {
    font-size: 3rem;
    margin: 0;
    letter-spacing: 0.05em;
  }
  .tag {
    margin: -0.8rem 0 0.5rem;
    color: var(--muted);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.85rem;
    color: var(--muted);
    flex: 1;
  }
  form {
    display: flex;
    gap: 0.5rem;
    align-items: flex-end;
  }
</style>
