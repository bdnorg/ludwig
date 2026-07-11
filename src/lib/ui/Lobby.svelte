<script lang="ts">
  import { newRoomCode } from '../roomcode';
  import { loadPlayer, savePlayer } from '../state/player';
  import { TEMPLATES, requestTemplate, type TemplateId } from '../state/templates';

  let player = $state(loadPlayer());
  let joinCode = $state('');
  let template = $state<TemplateId>('sandbox');

  function persistName() {
    savePlayer($state.snapshot(player));
  }

  function createTable() {
    persistName();
    requestTemplate(template);
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

  <div class="gallery">
    {#each TEMPLATES as t (t.id)}
      <button class="tmpl" class:selected={template === t.id} onclick={() => (template = t.id)}>
        <strong>{t.name}</strong>
        <span>{t.blurb}</span>
      </button>
    {/each}
  </div>

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
  .gallery {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .tmpl {
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.55rem 0.8rem;
  }
  .tmpl span {
    font-size: 0.75rem;
    color: var(--muted);
  }
  .tmpl.selected {
    border-color: var(--accent);
    outline: 1px solid var(--accent);
  }
</style>
