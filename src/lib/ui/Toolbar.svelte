<script lang="ts">
  import { table } from '../state/store.svelte';
  import { savePlayer } from '../state/player';
  import { inviteLink } from '../roomcode';

  let {
    onAddMenu,
    onImport,
    onExport,
    onUndo,
    onReference,
    hasReference = false,
  }: {
    onAddMenu: (e: MouseEvent) => void;
    onImport: (file: File) => void;
    onExport: () => void;
    onUndo: () => void;
    onReference?: () => void;
    hasReference?: boolean;
  } = $props();

  let copied = $state(false);
  let fileInput: HTMLInputElement;

  function copyInvite() {
    navigator.clipboard.writeText(inviteLink(table.room));
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  function renamed() {
    savePlayer(table.profile());
    table.players[table.me.id] = table.profile();
    table.net?.sendProfile();
  }
</script>

<div class="toolbar">
  <a class="brand" href="#/">ludwig</a>
  <span class="room">{table.room}</span>
  <button class="tinybtn" onclick={copyInvite}>{copied ? 'copied!' : 'copy invite'}</button>

  <span class="sep"></span>
  <button class="primary" onclick={onAddMenu}>+ add to table</button>
  <button
    class="tinybtn"
    onclick={onUndo}
    disabled={table.undoDepth === 0}
    title="undo my last action (⌘Z)"
  >
    ↩ undo
  </button>
  {#if hasReference}
    <button class="tinybtn" onclick={onReference} title="this gamebox's rules/reference pages">
      📖 reference
    </button>
  {/if}

  <span class="spacer"></span>
  <button class="tinybtn" onclick={onExport} title="save the table as a file — a save doubles as a template">
    export
  </button>
  <button class="tinybtn" onclick={() => fileInput.click()}>import</button>
  <input
    type="file"
    accept="application/json"
    bind:this={fileInput}
    hidden
    onchange={(e) => {
      const f = e.currentTarget.files?.[0];
      if (f) onImport(f);
      e.currentTarget.value = '';
    }}
  />
  <input class="name" bind:value={table.me.name} onchange={renamed} maxlength="24" title="your name" />
</div>

<style>
  .toolbar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 44px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    background: rgba(30, 34, 43, 0.92);
    border-bottom: 1px solid #454f60;
    z-index: 200000;
  }
  .brand {
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--accent);
    text-decoration: none;
  }
  .room {
    color: var(--muted);
    font-size: 0.8rem;
  }
  .sep {
    width: 1px;
    height: 22px;
    background: #454f60;
    margin: 0 4px;
  }
  .spacer {
    flex: 1;
  }
  button {
    font-size: 0.8rem;
    padding: 0.3rem 0.6rem;
  }
  .tinybtn {
    font-size: 0.7rem;
    color: var(--muted);
  }
  .name {
    width: 8rem;
    font-size: 0.8rem;
    padding: 0.25rem 0.5rem;
  }
</style>
