<script lang="ts">
  import type { NoteEntity } from '../model/types';
  import { table } from '../state/store.svelte';

  let { note }: { note: NoteEntity } = $props();
  let editing = $state(false);
  let draft = $state('');

  function startEdit(e: Event) {
    e.stopPropagation();
    draft = note.state.text;
    editing = true;
  }

  function commit() {
    editing = false;
    if (draft !== note.state.text)
      table.update(note, (n) => {
        n.state.text = draft;
      });
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="note" style:background={note.config.color} ondblclick={startEdit}>
  {#if editing}
    <!-- svelte-ignore a11y_autofocus -->
    <textarea
      bind:value={draft}
      onblur={commit}
      onpointerdown={(e) => e.stopPropagation()}
      autofocus
    ></textarea>
  {:else}
    <span>{note.state.text || 'double-click to edit'}</span>
  {/if}
</div>

<style>
  .note {
    width: 140px;
    min-height: 90px;
    padding: 8px;
    border-radius: 3px;
    color: #33301f;
    font-size: 0.8rem;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.35);
    white-space: pre-wrap;
    word-break: break-word;
  }
  span {
    user-select: none;
  }
  textarea {
    width: 100%;
    height: 80px;
    border: none;
    background: transparent;
    font: inherit;
    color: inherit;
    resize: none;
    outline: none;
  }
</style>
