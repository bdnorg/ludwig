<script lang="ts">
  import { onMount } from 'svelte';
  import { newRoomCode } from '../roomcode';
  import { listPlayers, loadPlayer, newPlayer, savePlayer } from '../state/player';
  import { deleteTable, download, listTables, renameTable } from '../state/persist';
  import { requestGamebox, requestImport, requestTemplate, TEMPLATES, type TemplateId } from '../state/templates';
  import { fetchGameboxGallery, type GameboxGalleryEntry } from '../state/gameboxGallery';
  import { assertPortableAssets, validateGamebox } from '../model/gamebox';

  let importInput: HTMLInputElement;
  async function importTemplate(file: File) {
    try {
      const snap = JSON.parse(await file.text());
      if (!snap?.entities) throw new Error('not a ludwig table file');
      persistName();
      requestImport(snap);
      location.hash = `#/t/${newRoomCode()}`;
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  let gameboxInput: HTMLInputElement;
  async function uploadGamebox(file: File) {
    try {
      const manifest = validateGamebox(JSON.parse(await file.text()));
      assertPortableAssets(manifest);
      persistName();
      requestGamebox(manifest);
      location.hash = `#/t/${newRoomCode()}`;
    } catch (err) {
      alert(`Gamebox upload failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  function downloadBox(entry: GameboxGalleryEntry) {
    download(`${entry.id}.manifest.json`, entry.manifest);
  }

  let roster = $state(listPlayers());
  let player = $state(loadPlayer());
  let joinCode = $state('');
  let tables = $state(listTables());

  // M18: built-in gamebox packages, fetched from public/gameboxes/. A box
  // supersedes the code template of the same id in the gallery (once it has
  // loaded) so the same game never appears twice; anything fetch-only
  // (euchre) is simply appended. Until the fetch resolves, the code
  // template fills in — same table either way.
  let boxes = $state<GameboxGalleryEntry[]>([]);
  onMount(() => {
    fetchGameboxGallery().then((b) => (boxes = b));
  });

  type Selection = { kind: 'template'; id: TemplateId } | { kind: 'box'; entry: GameboxGalleryEntry };
  let selection = $state<Selection>({ kind: 'template', id: 'sandbox' });

  // if the box gallery finishes loading after the player already picked a
  // template that a box now supersedes, follow the switch so the highlight
  // (and Start button) still points at something visible
  $effect(() => {
    const sel = selection;
    if (sel.kind !== 'template') return;
    const box = boxes.find((b) => b.id === sel.id);
    if (box) selection = { kind: 'box', entry: box };
  });

  let gallery = $derived.by(() => {
    const boxed = new Set(boxes.map((b) => b.id));
    const items: ({ kind: 'template'; id: TemplateId; name: string; blurb: string } | { kind: 'box'; entry: GameboxGalleryEntry })[] = [];
    for (const t of TEMPLATES) if (!boxed.has(t.id)) items.push({ kind: 'template', id: t.id, name: t.name, blurb: t.blurb });
    for (const b of boxes) items.push({ kind: 'box', entry: b });
    return items;
  });

  function pickPlayer(id: string) {
    const p = id === 'new' ? newPlayer() : roster.find((r) => r.id === id);
    if (!p) return;
    player = { ...p };
    savePlayer($state.snapshot(player));
    roster = listPlayers();
  }

  function ago(t: number): string {
    if (!t) return '';
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    if (m < 60 * 48) return `${Math.round(m / 60)}h ago`;
    return `${Math.round(m / 1440)}d ago`;
  }

  function rename(room: string, current: string) {
    const name = prompt('Table name:', current);
    if (name) {
      renameTable(room, name);
      tables = listTables();
    }
  }

  function remove(room: string, name: string) {
    if (confirm(`Delete "${name}" from this browser? (Other players keep their copies.)`)) {
      deleteTable(room);
      tables = listTables();
    }
  }

  function persistName() {
    savePlayer($state.snapshot(player));
    roster = listPlayers();
  }

  function createTable() {
    persistName();
    if (selection.kind === 'box') requestGamebox(selection.entry.manifest);
    else requestTemplate(selection.id);
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
  <p class="tag">a table for playing games — bring your own rules · <a href="#/help">how it works</a></p>

  <div class="who">
    {#if roster.filter((p) => p.name).length > 0}
      <label>
        Playing as
        <select
          value={player.id}
          onchange={(e) => pickPlayer(e.currentTarget.value)}
          title="this tab's identity — other tabs can play as someone else"
        >
          {#each roster as p (p.id)}
            <option value={p.id}>{p.name || '(unnamed)'}</option>
          {/each}
          <option value="new">+ new player</option>
        </select>
      </label>
    {/if}
    <label>
      Your name
      <input placeholder="e.g. Beth" bind:value={player.name} onchange={persistName} maxlength="24" />
    </label>
  </div>

  <div class="gallery">
    {#each gallery as item (item.kind === 'template' ? `t:${item.id}` : `b:${item.entry.id}`)}
      {#if item.kind === 'template'}
        <button
          class="tmpl"
          class:selected={selection.kind === 'template' && selection.id === item.id}
          onclick={() => (selection = { kind: 'template', id: item.id })}
        >
          <strong>{item.name}</strong>
          <span>{item.blurb}</span>
        </button>
      {:else}
        <div class="tmpl box" class:selected={selection.kind === 'box' && selection.entry.id === item.entry.id}>
          <button class="boxpick" onclick={() => (selection = { kind: 'box', entry: item.entry })}>
            <strong>{item.entry.name}</strong>
            <span>{item.entry.blurb}</span>
          </button>
          <button class="tinybtn" title="download {item.entry.name} manifest.json" onclick={() => downloadBox(item.entry)}>
            ⇩
          </button>
        </div>
      {/if}
    {/each}
    <button
      class="tmpl"
      disabled={!player.name.trim()}
      title="start a table from an exported ludwig file"
      onclick={() => importInput.click()}
    >
      <strong>⇪ Import a template…</strong>
      <span>Any exported table file — a save doubles as a template.</span>
    </button>
    <input
      type="file"
      accept="application/json"
      bind:this={importInput}
      hidden
      onchange={(e) => {
        const f = e.currentTarget.files?.[0];
        if (f) importTemplate(f);
        e.currentTarget.value = '';
      }}
    />
    <button
      class="tmpl"
      disabled={!player.name.trim()}
      title="load a single gamebox manifest.json — its assets must be absolute URLs or data: URIs"
      onclick={() => gameboxInput.click()}
    >
      <strong>⇧ Upload a gamebox…</strong>
      <span>A pure-config manifest.json exported from another table's gallery.</span>
    </button>
    <input
      type="file"
      accept="application/json"
      bind:this={gameboxInput}
      hidden
      onchange={(e) => {
        const f = e.currentTarget.files?.[0];
        if (f) uploadGamebox(f);
        e.currentTarget.value = '';
      }}
    />
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

  {#if tables.length > 0}
    <div class="mytables">
      <span class="heading">My tables</span>
      {#each tables as t (t.room)}
        <div class="row">
          <a href="#/t/{t.room}" class="open">
            <strong>{t.name}</strong>
            <span class="sub">{t.room} · {t.pieces} pieces · {ago(t.savedAt)}</span>
          </a>
          <button class="tinybtn" title="rename" onclick={() => rename(t.room, t.name)}>✎</button>
          <button class="tinybtn" title="delete" onclick={() => remove(t.room, t.name)}>✕</button>
        </div>
      {/each}
    </div>
  {/if}
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
  .tag a {
    color: var(--accent);
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
  .who {
    display: flex;
    gap: 0.5rem;
  }
  select {
    padding: 0.35rem 0.4rem;
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
  .tmpl.box {
    flex-direction: row;
    align-items: center;
    padding: 0.15rem 0.4rem 0.15rem 0;
    gap: 0.2rem;
  }
  .boxpick {
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    flex: 1;
    padding: 0.4rem 0.4rem 0.4rem 0.8rem;
    background: none;
    border: none;
  }
  .boxpick span {
    font-size: 0.75rem;
    color: var(--muted);
  }
  .mytables {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    border-top: 1px solid #454f60;
    padding-top: 1rem;
  }
  .heading {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--muted);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .open {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    color: var(--text);
    text-decoration: none;
    background: var(--panel);
    border: 1px solid #454f60;
    border-radius: 6px;
    padding: 0.45rem 0.7rem;
  }
  .open:hover {
    border-color: var(--accent);
  }
  .sub {
    font-size: 0.7rem;
    color: var(--muted);
  }
  .tinybtn {
    font-size: 0.7rem;
    padding: 0.3rem 0.5rem;
    color: var(--muted);
  }
</style>
